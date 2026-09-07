#!/usr/bin/env python3
"""Configure the local API and optionally install its Codex skill. No image generation."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

def write_private(path,content):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as out:out.write(content)
    os.chmod(path,0o600)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node');parser.add_argument('--gemini-env-file');parser.add_argument('--port',type=int,default=8787)
    parser.add_argument('--config-dir',default=str(Path.home()/'.config/holo-card'))
    parser.add_argument('--data-dir',default=str(Path.home()/'.local/share/holo-card'))
    parser.add_argument('--skill-source');parser.add_argument('--skill-target',default=str(Path(os.environ.get('CODEX_HOME',Path.home()/'.codex'))/'skills/holo-card'))
    args=parser.parse_args();root=Path(__file__).resolve().parents[1]
    node=args.node or shutil.which('node')
    if not node:raise RuntimeError('Node.js 24+ is required; pass --node with its executable path.')
    version=subprocess.check_output([node,'--version'],text=True).strip()
    if int(version.lstrip('v').split('.')[0])<24:raise RuntimeError('Node.js 24+ is required.')
    subprocess.run([node,'--input-type=module','-e',"import('sharp').then(()=>{})"],cwd=root,check=True)
    config=Path(args.config_dir).expanduser().resolve();data=Path(args.data_dir).expanduser().resolve();config.mkdir(parents=True,exist_ok=True,mode=0o700)
    if args.gemini_env_file:
        lines=Path(args.gemini_env_file).expanduser().read_text().splitlines()
        key=next((line.split('=',1)[1].strip().strip('"\'') for line in lines if line.startswith('GEMINI_API_KEY=')),None)
        if not key:raise RuntimeError('The supplied private env file has no GEMINI_API_KEY entry.')
        write_private(config/'service.env','GEMINI_API_KEY='+key+'\n')
    service={'node_executable':str(Path(node).resolve()),'api_root':str(root),'data_dir':str(data),'host':'127.0.0.1','port':args.port,'env_file':str(config/'service.env') if (config/'service.env').exists() else None}
    write_private(config/'service.json',json.dumps(service,indent=2)+'\n')
    credential=config/'client.json'
    if not credential.exists():
        subprocess.run([node,str(root/'src/admin.mjs'),'token-create','--output',str(credential),'--data-dir',str(data),'--url',f'http://127.0.0.1:{args.port}'],check=True,stdout=subprocess.DEVNULL)
    else:
        existing=json.loads(credential.read_text());expected=f'http://127.0.0.1:{args.port}'
        if existing.get('api_url')!=expected:raise RuntimeError('Existing client points to another API. Preserve it and use a separate --config-dir.')
    target=None
    if args.skill_source:
        source=Path(args.skill_source).expanduser().resolve();target=Path(args.skill_target).expanduser().resolve()
        if not (source/'SKILL.md').is_file():raise RuntimeError('Skill source has no SKILL.md.')
        if target.exists():raise RuntimeError('Skill target already exists; review it before replacing. API configuration is preserved.')
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copytree(source,target,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    print(json.dumps({'configured':True,'api_url':f'http://127.0.0.1:{args.port}','provider_configured':bool(service['env_file']),'skill_directory':str(target) if target else None,'generation_submitted':False},ensure_ascii=False))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'error':'LOCAL_INSTALL_FAILED','message':str(error) if isinstance(error,RuntimeError) else 'Check the runtime, dependencies and private configuration paths.'}));sys.exit(1)
