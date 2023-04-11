import fs from 'fs';
import StreamZip from 'node-stream-zip';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  StorageClass,
  _Object,
} from '@aws-sdk/client-s3';

import path from 'path';
import PersistentMap from 'persistentmap';

import { AvifProcessor } from './avif.js';
import { TaskQueue } from './task-queue.js';
import { determineOutputFilename } from './filename-handling.js';

import { awsAuthFile, bucketName, bucketPrefix, zipDir } from './config.js';

async function main() {
  // To make synchronisation faster, we cache the computed sizes of
  // AVIFs for each file in a persistent map
  const map = new PersistentMap<string, number>('cached-avifsizes.txt');
  await map.load();
  await map.compact();

  AvifProcessor.setup();

  const { accessKeyId, secretAccessKey, region } = JSON.parse(
    await fs.promises.readFile(awsAuthFile, 'utf8')
  );

  const credentials = {
    accessKeyId,
    secretAccessKey,
  };

  const s3 = new S3Client({
    credentials,
    region,
  });

  const knownS3Objects = new Map<string, _Object>();

  /**
   * Maps from output S3 name to the zip the source file came from.
   * Used to detect S3 files we can delete and target files coming from multiple zips.
   */
  const expectedS3Names = new Map<string, string>();

  let pageToken: string | undefined;

  do {
    const s3Contents = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: bucketPrefix,
        ContinuationToken: pageToken,
      })
    );

    if (s3Contents.Contents) {
      for (const obj of s3Contents.Contents) {
        if (obj.Size! > 0) {
          knownS3Objects.set(obj.Key!, obj);
        }
      }
    }
    pageToken = s3Contents.NextContinuationToken;
  } while (pageToken);

  console.log(`Total S3 contents: ${knownS3Objects.size}`);

  const taskQueue = new TaskQueue(8);

  for (const zipName of await fs.promises.readdir(zipDir)) {
    if (zipName.startsWith(".")) {
      // macOS file
      continue;
    }

    const fullFilename = path.join(zipDir, zipName);
    const stat = await fs.promises.stat(fullFilename);
    if (!stat.isFile()) {
      continue;
    }

    console.log('Processing zip', fullFilename);

    const zip = new StreamZip.async({
      file: fullFilename,
    });

    const zipEntries = await zip.entries();

    for (const [name, entry] of Object.entries(zipEntries)) {
      if (!entry.isFile) {
        continue;
      }

      const newName = determineOutputFilename(name);
      if (!newName) {
        continue;
      }

      const avifFilename = newName.replace(/\.png$/, '.avif');

      let proposedS3Filename = 'forgottenadventures/' + avifFilename;

      // There are sometimes alternate versions of a token between one
      // pack and another, so we'll rename the later ones to have an '_Alt' suffix

      if (expectedS3Names.has(proposedS3Filename)) {
        // const otherZip = expectedS3Names.get(s3Filename);
        // console.warn(`Collision for destination ${s3Filename}: ${otherZip}`);
        proposedS3Filename = proposedS3Filename.replace('.avif', '_Alt.avif');
        // console.warn(` - renaming to ${s3Filename}`);

        if (proposedS3Filename.includes('_Alt_Alt')) {
          throw new Error('DOUBLE ALT!');
        }
      }

      const s3Filename = proposedS3Filename;

      expectedS3Names.set(s3Filename, fullFilename);

      await taskQueue.queue(async () => {
        const avifProcessor = new AvifProcessor(() => zip.entryData(name));

        const cacheKey = `${zipName}:${name}`;

        let avifSize = map.get(cacheKey);
        if (!avifSize) {
          console.log(`Computing size for ${s3Filename}`);
          avifSize = await avifProcessor.getAvifSize();
          await map.set(cacheKey, avifSize);
        }

        let existingS3Entry = knownS3Objects.get(s3Filename);

        // Standard S3 is $0.024/GB/month
        // IA is          $0.0131 per GB with a minimum size of 128KB
        // so objects _nearly_ 128KB are worth putting in IA (they're rounded to 128KB).
        // The downside of IA is that IA objects incur retrieval charges and have a minimum storage duration of 30 days.
        // Objects bigger than than 128KB can go into intelligent tiering.
        // Very small objects just stay in regular S3
        let storageClass = StorageClass.INTELLIGENT_TIERING;
        if (avifSize < 128 * 1024) {
          storageClass = StorageClass.ONEZONE_IA;
        }
        if (avifSize < 90 * 1024) {
          storageClass = StorageClass.STANDARD;
        }

        if (existingS3Entry) {
          if (avifSize !== existingS3Entry.Size) {
            console.log(
              `Wrong version of file at ${existingS3Entry.Key} (local ${avifSize} bytes vs uploaded ${existingS3Entry.Size}). Deleting and reuploading.`
            );
            await s3.send(
              new DeleteObjectCommand({
                Bucket: bucketName,
                Key: existingS3Entry.Key,
              })
            );
            existingS3Entry = undefined;
          }
        }

        if (existingS3Entry) {
          if (storageClass !== existingS3Entry.StorageClass) {
            console.log(
              `Need to change storage class for ${existingS3Entry.Key} (${avifSize} bytes) from ${existingS3Entry.StorageClass} to ${storageClass}`
            );
            const copySource = `/${bucketName}/${encodeURIComponent(
              existingS3Entry.Key!
            )}`;
            await s3.send(
              new CopyObjectCommand({
                CopySource: copySource,
                Bucket: bucketName,
                Key: s3Filename,
                StorageClass: storageClass,
                MetadataDirective: 'COPY',
              })
            );
          }
          return;
        }

        console.log(
          `Need to upload ${name} (${await avifProcessor.getOriginalSize()}) as ${s3Filename} (${avifSize})`
        );

        const extname = path.extname(s3Filename);
        let contentType;
        switch (extname) {
          case '.png':
            contentType = 'image/png';
            break;
          case '.avif':
            contentType = 'image/avif';
            break;
          default:
            throw Error(`What content-type for ${s3Filename}?`);
        }

        const avifContent = await avifProcessor.getAvif();

        await s3.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: s3Filename,
            Body: avifContent,
            StorageClass: storageClass,
            ContentType: contentType,
            CacheControl: 's-max-age: 31536000, max-age: 31536000, immutable',
          })
        );
      });
    }

    await taskQueue.waitForEmpty();
    zip.close();
  }

  await taskQueue.waitForEmpty();

  // Check to see if there are S3 objects that shouldn't be there.
  for (const existingS3Name of knownS3Objects.keys()) {
    if (!expectedS3Names.has(existingS3Name)) {
      console.log(`Should remove ${existingS3Name}`);
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: existingS3Name,
        })
      );
    }
  }
}

void main();
