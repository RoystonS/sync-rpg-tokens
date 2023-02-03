// @ts-check

import fs from 'fs';
import StreamZip from 'node-stream-zip';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  StorageClass,
} from '@aws-sdk/client-s3';

import path from 'path';

async function main() {
  const awsAuthFile = '/home/royston/foundry/foundrydata/Config/awsconfig.json';
  const bucketName = 'shufflies-rpg-tokens';
  const bucketPrefix = 'forgottenadventures';

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

  /** @type {Map<string, import("@aws-sdk/client-s3")._Object>} */
  const knownS3Objects = new Map();

  /**
   * Maps from output S3 name to the zip the source file came from.
   * Used to detect S3 files we can delete and target files coming from multiple zips.
   * @type {Map<string, string>}
   */
  const expectedS3Names = new Map();

  let pageToken = undefined;

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
        if (obj.Size > 0) {
          knownS3Objects.set(/** @type {string} */ (obj.Key), obj);
        }
      }
    }
    pageToken = s3Contents.NextContinuationToken;
  } while (pageToken);

  console.log(`Total S3 contents: ${knownS3Objects.size}`);
  const zipDir = '/mnt/games_backup/ForgottenAdventures/Tokens';

  const queue = new Queue();

  for (const zipName of await fs.promises.readdir(zipDir)) {
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
      //   console.log(`Name: ${name}`);
      const newFilename = fixFilename(name);
      if (!newFilename) {
        continue;
      }

      let s3Filename = 'forgottenadventures/' + newFilename;

      // There are sometimes alternate versions of a token between one
      // pack and another, so we'll rename the later ones to have an '_Alt' suffix

      if (expectedS3Names.has(s3Filename)) {
        const otherZip = expectedS3Names.get(s3Filename);
        // console.warn(`Collision for destination ${s3Filename}: ${otherZip}`);
        s3Filename = s3Filename.replace('.png', '_Alt.png');
        // console.warn(` - renaming to ${s3Filename}`);

        if (s3Filename.includes('_Alt_Alt')) {
          throw new Error('DOUBLE ALT!');
        }
      }

      expectedS3Names.set(s3Filename, fullFilename);

      let existingS3Entry = knownS3Objects.get(s3Filename);

      const content = await zip.entryData(name);

      // Standard S3 is $0.024/GB/month
      // IA is          $0.0131 per GB with a minimum size of 128KB
      // so objects _nearly_ 128KB are worth putting in IA
      // Objects bigger than than 128KB can go into intelligent tiering.
      // Very small objects just stay in regular S3 (which we can do by setting to intelligent tiering, for consistency)
      const size = content.length;
      let storageClass = StorageClass.INTELLIGENT_TIERING;
      if (size < 128 * 1024) {
        storageClass = StorageClass.ONEZONE_IA;
      }
      if (size < 96 * 1024) {
        storageClass = StorageClass.INTELLIGENT_TIERING;
      }

      if (existingS3Entry) {
        if (size !== existingS3Entry.Size) {
          console.log(
            `Wrong version of file at ${existingS3Entry.Key} (${size} bytes vs ${existingS3Entry.Size}). Deleting and reuploading.`
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
            `Need to change storage class for ${existingS3Entry.Key} (${size} bytes) from ${existingS3Entry.StorageClass} to ${storageClass}`
          );
          const copySource = `/${bucketName}/${encodeURIComponent(
            /** @type {string} */ (existingS3Entry.Key)
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
        continue;
      }

      console.log(`Need to upload ${name} as ${s3Filename}`);
      const lease = await queue.reserveSlot();

      const extname = path.extname(s3Filename);
      let contentType;
      switch (extname) {
        case '.png':
          contentType = 'image/png';
          break;
        default:
          throw Error(`What content-type for ${s3Filename}?`);
      }

      s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Filename,
          Body: content,
          StorageClass: storageClass,
          ContentType: contentType,
          CacheControl: 's-max-age: 31536000, max-age: 31536000, immutable',
        })
      )
        .catch((err) => {
          console.error(`ERROR: ${err}`);
        })
        .finally(() => {
          lease?.dispose();
        });
    }

    zip.close();
  }

  await queue.waitForEmpty();

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

class Lease {
  /** @type {Promise<Lease>} */
  promise;

  /** @type {(lease: Lease) => void} */
  resolve;

  /** @type {Queue} */
  queue;

  /** @type {(queue: Queue) => boolean} */
  condition;

  /** @type {(queue: Queue) => void} */
  action;

  /**
   * @param {Queue} queue
   * @param {(queue: Queue) => boolean} condition
   * @param {(queue: Queue) => void} action
   */
  constructor(queue, condition, action) {
    this.queue = queue;
    this.action = action;
    this.condition = condition;

    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  dispose() {
    this.queue.leaseDone();
  }
}

class Queue {
  activeCount = 0;
  maximum = 10;

  /** @type {Set<Lease>} */
  waiters = new Set();

  leaseDone() {
    this.activeCount--;

    /** @type {Set<Lease>} */
    const toRemove = new Set();

    for (const waiter of this.waiters) {
      if (waiter.condition(this)) {
        toRemove.add(waiter);
        waiter.action(this);
        waiter.resolve(waiter);
      }
    }

    for (const expiredWaiter of toRemove) {
      this.waiters.delete(expiredWaiter);
    }
  }

  reserveSlot() {
    const lease = new Lease(
      this,
      (q) => q.activeCount < q.maximum,
      (q) => q.activeCount++
    );
    return this.waitForLease(lease);
  }

  waitForEmpty() {
    const lease = new Lease(
      this,
      (q) => q.activeCount === 0,
      () => {}
    );
    return this.waitForLease(lease);
  }

  /**
   * @param {Lease} lease
   */
  waitForLease(lease) {
    if (lease.condition(this)) {
      // We're done.
      lease.action(this);
      return lease;
    } else {
      this.waiters.add(lease);
      return lease.promise;
    }
  }
}

/**
 *
 * @param {string} filename
 * @returns {string|null}
 */
function fixFilename(filename) {
  if (filename.endsWith('.url') || filename.endsWith('.pdf')) {
    return null;
  }
  if (filename.startsWith('Mapmaking/')) {
    return null;
  }

  filename = filename.replace(/^FA_Tokens\//, 'Tokens/');
  filename = filename.replace(
    /Tokens\/Spirits\/Creature[ _]Spirits_Pack_\d+/,
    'Tokens/Spirits/Creatures'
  );
  filename = filename.replace(
    'Spirits/Creature_Spirits/',
    'Spirits/Creatures/'
  );
  filename = filename.replace(
    /Spirits\/Spirits_(Adversaries|Creatures|Heroes|NPCs)\//,
    (_, g) => `Spirits/${g}/`
  );
  filename = filename.replace(
    'Spirits/Commoner_Spirits/',
    'Spirits/Commoners/'
  );
  filename = filename.replace('Creature Tokens Pack 2/', 'Tokens/');

  filename = filename.replace(/1⁄8/g, '1∕8');
  filename = filename.replace(/1⁄4/g, '1∕4');
  filename = filename.replace(/1⁄2/g, '1∕2');
  filename = filename.replace(/CR (.)/, (_, g) => `CR_${g[0]}`);
  filename = filename.replace('_Catch-All_Heroes', 'Catch-All_Heroes');
  filename = filename.replace(
    'Tokens/Spirits/Catch-All_Heroes_Spirits',
    'Tokens/Spirits/Catch-All_Heroes'
  );

  // Tokens/NPCs/Townsfolk_02/Townsfolk_AA1_01.png
  filename = filename.replace(/Townsfolk_(\d+)/, 'Townsfolk');

  // Creatures/CR_1/Giant_Bearded_Vulture_Large_Beast_01.png
  if (filename.startsWith('Creatures')) {
    filename = 'Tokens/' + filename;
  }

  // Consistency? :(
  filename = filename.replace('Unknown_CR', 'CR_unknown');

  const goodKnownPrefixes = [
    'Tokens/Adversaries/',
    /^Tokens\/Creatures\/CR_\d∕?\d?\//,
    /^Tokens\/Base(less)?\/CR_\d?∕?\d?\//,
    'Tokens/Creatures/CR_unknown/',
    /^Tokens\/Creatures\/(Aberration|Beast|Celestial|Construct|Dragon|Elemental|Fey|Fiend|Giant|Guards_Desert|Humanoid|Monstrosity|Ooze|Plant|Undead)\//,
    /^Tokens\/Spirits\/(Adversaries|Catch-All_Heroes|Commoners|Creatures|Heroes|NPCs)\//,
    /^Tokens\/Heroes\/(Bearfolk|Catch-All_Heroes|Dragonborn|Dwarf|Elf|Firbolg|Gnome|Goliath|Halfling|Half_Elf|Half_Orc|Human|Gnoll|Kenku|Kitsune|Planetouched|Tabaxi|Tiefling|Tortle|Trollkin|Warforged)\//,
    /^Tokens\/NPCs\/(Commoners|Townsfolk)\//,
    'Tokens/Spirits/Catch-All_Heroes_Spirits/',
  ];

  if (
    goodKnownPrefixes.some((f) => {
      if (f instanceof RegExp) {
        return f.test(filename);
      } else {
        return filename.startsWith(f);
      }
    })
  ) {
    return filename;
  }

  throw new Error(`What do I do with ${filename}?`);
}

void main();
