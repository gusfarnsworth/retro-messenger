import {useCallback,useEffect,useRef,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {check,type Update} from '@tauri-apps/plugin-updater';
import {relaunch} from '@tauri-apps/plugin-process';
import {DownloadCloud,RefreshCw,ShieldCheck,X} from 'lucide-react';
import packageInfo from '../package.json';
import './updater.css';

const VERSION = packageInfo.version;
type Stage = 'idle'|'checking'|'current'|'available'|'downloading'|'installing'|'error';
type Progress = {received:number,total:number};

function describeError(error:unknown):string {
  const message=error instanceof Error?error.message:String(error);
  // Avoid showing raw endpoint/implementation details for the common initial setup case.
  if(/404|not found|failed to fetch|status.*(?:404|204)/i.test(message))
    return 'The release feed is not available yet. Publish a signed GitHub release first.';
  return message || 'Unable to check for updates.';
}

/** The updater API is native-only and verifies the downloaded installer signature. */
function useSignedUpdater() {
  const [stage,setStage]=useState<Stage>('idle');
  const [version,setVersion]=useState('');
  const [notes,setNotes]=useState('');
  const [error,setError]=useState('');
  const [progress,setProgress]=useState<Progress>({received:0,total:0});
  const available=useRef<Update|null>(null);
  const busy=useRef(false);

  const checkNow=useCallback(async()=>{
    if(!isTauri() || busy.current)return;
    if(import.meta.env.DEV){setStage('idle');setError('The signed updater is tested in installed release builds, not desktop:dev.');return;}
    busy.current=true;
    setStage('checking');setError('');
    try{
      const result=await check();
      if(available.current && available.current!==result)await available.current.close().catch(()=>{});
      available.current=result;
      if(result){
        setVersion(result.version);
        setNotes(result.body||'A new Retro Messenger version is ready to install.');
        setStage('available');
      }else setStage('current');
    }catch(e){setError(describeError(e));setStage('error')}
    finally{busy.current=false}
  },[]);

  const install=useCallback(async()=>{
    if(busy.current||!available.current)return;
    busy.current=true;
    setStage('downloading');setError('');setProgress({received:0,total:0});
    let received=0,total=0;
    try{
      await available.current.downloadAndInstall(event=>{
        if(event.event==='Started'){
          received=0;total=event.data.contentLength??0;
          setProgress({received,total});
        }else if(event.event==='Progress'){
          received+=event.data.chunkLength;
          setProgress({received,total});
        }else if(event.event==='Finished')setStage('installing');
      });
      // On Windows the installer may terminate the process before this resolves.
      setStage('installing');
      await relaunch();
    }catch(e){setError(describeError(e));setStage('error')}
    finally{busy.current=false}
  },[]);

  const dismiss=useCallback(()=>{
    if(busy.current)return;
    if(available.current){void available.current.close().catch(()=>{});available.current=null}
    setStage('idle');
  },[]);
  return {stage,version,notes,error,progress,checkNow,install,dismiss};
}

function DownloadStatus({progress}:{progress:Progress}){
  const percent=progress.total>0?Math.min(100,Math.round(progress.received/progress.total*100)):null;
  return <div className="retro-update-progress" aria-live="polite">
    <div className="retro-update-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent??undefined}>
      <div style={{width:percent===null?'32%':`${percent}%`}}/>
    </div>
    <small>{percent===null?'Downloading the signed Windows installer…':`Downloading ${percent}%`}</small>
  </div>;
}

export function UpdateChecker(){
  const updater=useSignedUpdater();
  const [webStatus,setWebStatus]=useState('');
  const native=isTauri();
  async function checkWebsite(){
    setWebStatus('Checking web release information…');
    try{
      const response=await fetch('/updates.json',{cache:'no-store'});
      if(!response.ok)throw Error('Feed unavailable');
      const announcement=await response.json() as {version?:string;download_url?:string};
      const newest=announcement.version||VERSION;
      setWebStatus(`Website release announcement: ${newest}. Website updates are deployed through Vercel.`);
    }catch{setWebStatus('Release information is currently unavailable. The website updates on its next deployment.')}
  }
  return <div className="settings-panel retro-updates-settings">
    <h3><DownloadCloud size={17}/> Retro Messenger updates</h3>
    <p>Installed version: <strong>v{VERSION}</strong> · {native?'Windows desktop':'Web browser'}</p>
    {!native&&<><p>The website updates automatically when a new version is deployed.</p><button type="button" className="xp-button" onClick={()=>void checkWebsite()}>Check release information</button>{webStatus&&<p role="status">{webStatus}</p>}</>}
    {native&&<>
      <p>Updates are downloaded from official releases and must pass Tauri's signature verification before installation.</p>
      <button type="button" className="xp-button primary" onClick={()=>void updater.checkNow()} disabled={updater.stage==='checking'||updater.stage==='downloading'||updater.stage==='installing'}>
        <RefreshCw size={14}/> {updater.stage==='checking'?'Checking…':'Check for updates'}
      </button>
      {updater.stage==='current'&&<p role="status"><ShieldCheck size={15}/> You're running the newest available release.</p>}
      {updater.stage==='available'&&<div className="retro-update-available"><strong>Version {updater.version} is available</strong><p>{updater.notes}</p><button type="button" className="xp-button primary" onClick={()=>void updater.install()}>Download & install update</button></div>}
      {updater.stage==='downloading'&&<DownloadStatus progress={updater.progress}/>}
      {updater.stage==='installing'&&<p role="status">Installer verified. Windows is installing Retro Messenger; open conversations may close.</p>}
      {updater.error&&<p className="retro-update-error" role="alert">{updater.error}</p>}
      <small>For privacy, updates require your approval before downloading and installing. The website's release announcements cannot install Windows binaries.</small>
    </>}
  </div>;
}

/** Checks on startup of the MAIN native window only. No automatic installation. */
export function StartupUpdatePrompt(){
  const updater=useSignedUpdater();
  const [dismissed,setDismissed]=useState(false);
  useEffect(()=>{
    if(!isTauri()||import.meta.env.DEV)return;
    const timer=window.setTimeout(()=>{void updater.checkNow()},5500);
    return()=>window.clearTimeout(timer);
    // checkNow is stable. Do not repeat the startup request for every render.
  },[updater.checkNow]);
  if(!isTauri()||dismissed||(!['available','downloading','installing'].includes(updater.stage)))return null;
  return <aside className="retro-update-notice" role="dialog" aria-label="Retro Messenger update available">
    <div className="retro-update-notice-title"><span><DownloadCloud size={16}/> Retro Messenger Update</span><button type="button" title="Dismiss" onClick={()=>{updater.dismiss();setDismissed(true)}} disabled={updater.stage==='downloading'||updater.stage==='installing'}><X size={14}/></button></div>
    <div className="retro-update-notice-content">
      {updater.stage==='available'&&<><strong>Version {updater.version} is ready</strong><p>{updater.notes}</p><div className="retro-update-buttons"><button type="button" className="xp-button primary" onClick={()=>void updater.install()}>Download & install</button><button type="button" className="xp-button" onClick={()=>{updater.dismiss();setDismissed(true)}}>Later</button></div></>}
      {updater.stage==='downloading'&&<DownloadStatus progress={updater.progress}/>}
      {updater.stage==='installing'&&<p>Verifying and installing your update…</p>}
      {updater.error&&<p role="alert" className="retro-update-error">{updater.error}</p>}
    </div>
  </aside>;
}
