import fs from 'fs';
import os from 'os';

// Location of JSON file containing AWS auth information,
// as used by Foundry VTT.
export const awsAuthFile = findFirst([
  'awsconfig.json',
  'Y:/foundry11/foundrydata/Config/awsconfig.json',
  '/home/royston/foundry11/foundrydata/Config/awsconfig.json',
]);

// S3 bucket name
export const bucketName = 'shufflies-rpg-tokens';

// The tool will only manage files under this folder in the S3 bucket.
// Other files will be left alone.
export const bucketPrefix = 'forgottenadventures';

// The location of the Forgotten Adventures zips
export const zipDir = findFirst(['K:/ForgottenAdventures/Tokens', '/mnt/games_backup/ForgottenAdventures/Tokens']);

function findFirst(paths: string[]) {
  return paths.filter((p) => fs.existsSync(p))[0];
}

export const cpus = os.cpus().length;
