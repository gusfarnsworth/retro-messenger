import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(readFileSync(resolve(root,'src-tauri/tauri.conf.json'),'utf8'));
const packageJson=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
const pubkey=config.plugins?.updater?.pubkey||'';
const endpoint=config.plugins?.updater?.endpoints?.[0]||'';
const errors=[];
function validTauriPublicKey(key) {
  if(typeof key!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(key)||key.length<70)return false;
  try {
    const decoded=Buffer.from(key,'base64');
    if(decoded.toString('base64')!==key)return false;
    const lines=decoded.toString('utf8').trim().split(/\r?\n/);
    return lines.length>=2 && lines[0].startsWith('untrusted comment:') && /^[A-Za-z0-9+/=]{40,}$/.test(lines[1]);
  }catch{return false;}
}
if(!validTauriPublicKey(pubkey))errors.push('Updater public key missing or malformed. Run scripts/setup-updater.ps1 on your Windows PC.');
if(!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/latest\/download\/latest\.json$/.test(endpoint)||endpoint.includes('/OWNER/REPOSITORY/'))errors.push('GitHub Releases URL is not set. Run scripts/setup-updater.ps1 -Repository owner/repo.');
if(config.bundle?.createUpdaterArtifacts!==true)errors.push('bundle.createUpdaterArtifacts must be true.');
if(!config.bundle?.targets?.includes('nsis'))errors.push('NSIS installer target is missing.');
if(config.version!==packageJson.version)errors.push('The Tauri version and package.json version must match.');
if(errors.length){for(const e of errors)console.error('ERROR:',e);process.exit(1)}
console.log('Updater configuration valid for',packageJson.version);
console.log('Update endpoint:',endpoint);
console.log('Public signing key installed (private key not stored in project).');
