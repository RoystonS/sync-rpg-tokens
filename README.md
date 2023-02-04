Personal tool to synchronize [Forgotten Adventures](https://www.forgotten-adventures.net/) tokens to an S3 server.

* Transforms the source PNGs to much smaller AVIF files
* Transforms source files to a more consistent layout
* Chooses S3 storage class based on file size
* Synchronises the S3 content, removing files if necessary

To run:

1. Clone repo
2. `pnpm install`
3. Edit config in `config.ts`
4. (Optionally) tweak naming mappings in `filename-handling.ts`
5. `pnpm run sync`

