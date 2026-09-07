#!/usr/bin/env python3
"""Manage the separately configured local Holo API process; never invokes generation."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT=Path(os.environ.get('HOLO_CONFIG_DIR',Path.home()/'.config/holo-card')).expanduser()
CONFIG=ROOT/'service.json'
STATE=ROOT/'service-state.json'

def emit(value): print(json.dumps(value,ensure_ascii=False),flush=True)
def probe(url):
    try:
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url+'/healthz',timeout=1) as response:
            return json.loads(response.read()).get('service')=='holo-card-api'
    except Exception:return False

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['start','status','stop']);args=parser.parse_args()
    config=json.loads(CONFIG.read_text());host=config.get('host','127.0.0.1');port=int(config.get('port',8787));url=f'http://{host}:{port}'
    if args.command=='status':emit({'running':probe(url),'api_url':url});return
    if args.command=='start':
        if probe(url):emit({'running':True,'api_url':url,'started':False});return
        if host not in ('127.0.0.1','localhost','::1'):raise ValueError('This helper starts loopback services only. Use the service deployment configuration for remote hosting.')
        environment=os.environ.copy()
        if config.get('env_file'):
            for line in Path(config['env_file']).expanduser().read_text().splitlines():
                if line.startswith('GEMINI_API_KEY='):environment['GEMINI_API_KEY']=line.split('=',1)[1].strip().strip('"\'')
        environment.update({'HOLO_DATA_DIR':config['data_dir'],'HOST':host,'PORT':str(port)})
        root=Path(config['api_root']);entry=root/'src/server.mjs';node=Path(config['node_executable'])
        if not entry.is_file() or not node.is_file():raise ValueError('Configured API installation or Node runtime is unavailable.')
        ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
        fd=os.open(ROOT/'service.log',os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
        with os.fdopen(fd,'ab') as log:
            process=subprocess.Popen([str(node),str(entry)],cwd=root,env=environment,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        for _ in range(50):
            if process.poll() is not None:raise ValueError('API exited during startup. Check the private service log.')
            if probe(url):
                fd=os.open(STATE,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
                with os.fdopen(fd,'w') as out:json.dump({'pid':process.pid,'api_url':url,'entry':str(entry)},out)
                emit({'running':True,'started':True,'api_url':url});return
            time.sleep(.1)
        process.terminate();raise ValueError('API did not become ready. No generation was submitted.')
    if args.command=='stop':
        if not STATE.exists():emit({'stopped':False,'reason':'No managed process record'});return
        state=json.loads(STATE.read_text());pid=int(state['pid'])
        # Match the exact managed script to avoid signalling a recycled process ID.
        actual=subprocess.run(['ps','-p',str(pid),'-o','args='],capture_output=True,text=True).stdout
        if state['entry'] not in actual:emit({'stopped':False,'reason':'Managed process is no longer running'});return
        os.kill(pid,signal.SIGTERM)
        for _ in range(100):
            if not probe(url):
                STATE.unlink(missing_ok=True);emit({'stopped':True});return
            time.sleep(.1)
        emit({'stopping':True,'pid':pid})

if __name__=='__main__':
    try:main()
    except Exception as error:
        emit({'error':{'code':'LOCAL_SERVICE_UNAVAILABLE','message':str(error) if isinstance(error,ValueError) else 'Run the local API installer or check its private configuration.'}});sys.exit(1)
