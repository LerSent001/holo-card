#!/usr/bin/env python3
"""Standard-library client for Holo Card API. Never prints the API credential."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

class ClientError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def config_path():
    return Path(os.environ.get('HOLO_CONFIG', Path.home() / '.config/holo-card/client.json')).expanduser()

def private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write('\n')
    os.replace(temporary, path)

def valid_url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ClientError('INVALID_API_URL', 'Use an API base URL without credentials, query or fragment.')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost', '::1')):
        raise ClientError('HTTPS_REQUIRED', 'Remote API URLs must use HTTPS; HTTP is allowed only on loopback.')
    if not parsed.hostname:
        raise ClientError('INVALID_API_URL', 'A hostname is required.')
    return value.rstrip('/')

def configuration():
    path = config_path()
    try:
        if os.name != 'nt' and stat.S_IMODE(path.stat().st_mode) & 0o077:
            raise ClientError('INSECURE_CONFIG_PERMISSIONS', 'Set the client credential file permissions to 600.')
        data = json.loads(path.read_text())
    except FileNotFoundError:
        raise ClientError('NOT_CONFIGURED', 'Configure an API URL and token file first. No generation was submitted.')
    data['api_url'] = valid_url(data['api_url'])
    if not isinstance(data.get('api_token'), str) or not data['api_token']:
        raise ClientError('TOKEN_MISSING', 'The client credential file has no API token.')
    return data

class Client:
    def __init__(self, config=None):
        self.config = config or configuration()
        handlers = [NoRedirect()]
        if urllib.parse.urlsplit(self.config['api_url']).hostname in ('127.0.0.1','localhost','::1'):
            handlers.append(urllib.request.ProxyHandler({}))
        self.opener = urllib.request.build_opener(*handlers)
    def request(self, path, method='GET', data=None, headers=None, binary=False, timeout=30):
        if not path.startswith('/') or path.startswith('//'):
            raise ClientError('INVALID_API_PATH', 'Expected an API-relative path.')
        h = {'Authorization': 'Bearer ' + self.config['api_token'], **(headers or {})}
        if isinstance(data, dict):
            data = json.dumps(data).encode()
            h['Content-Type'] = 'application/json'
        req = urllib.request.Request(self.config['api_url'] + path, data=data, method=method, headers=h)
        try:
            with self.opener.open(req, timeout=timeout) as response:
                payload = response.read()
                return payload if binary else json.loads(payload)
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read()).get('error', {})
                raise ClientError(detail.get('code', 'HTTP_' + str(error.code)), detail.get('message', 'API request failed.'))
            except (ValueError, AttributeError):
                raise ClientError('HTTP_' + str(error.code), 'API request failed; no automatic resubmission was attempted.')
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            raise ClientError('CONNECTION_UNAVAILABLE', 'API connection failed. For generation, keep the same card and request key and query the saved job before resubmitting.')
    def upload(self, path, name=None):
        file = Path(path).expanduser().resolve()
        if not file.is_file() or not 0 < file.stat().st_size <= 8*1024*1024:
            raise ClientError('INVALID_FILE', 'Choose an image file up to 8 MiB.')
        boundary = 'holo-' + uuid.uuid4().hex
        filename = file.name.replace('"', '').replace('\r','').replace('\n','')
        payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode() + file.read_bytes() + b'\r\n'
        if name:
            payload += (f'--{boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n{name}\r\n').encode()
        payload += f'--{boundary}--\r\n'.encode()
        return self.request('/v1/cards', 'POST', payload, {'Content-Type': 'multipart/form-data; boundary=' + boundary})

def segment(value):
    return urllib.parse.quote(value, safe='')

def request_key(card_id, supplied=None):
    # Save a stable key before any network operation. Client restarts reuse it.
    directory = config_path().parent / 'requests'
    name = hashlib.sha256(card_id.encode()).hexdigest() + '.json'
    path = directory / name
    if path.exists():
        saved = json.loads(path.read_text())
        if supplied and supplied != saved['key']:
            raise ClientError('REQUEST_KEY_CONFLICT', 'A saved key already exists for this card. Reuse it to avoid duplicate work.')
        return saved['key']
    key = supplied or str(uuid.uuid4())
    # Atomically link a fully written record; another CLI never reads partial JSON.
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = directory / (name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump({'card_id':card_id,'key':key},out)
    try:
        os.link(temporary,path)
    except FileExistsError:
        return request_key(card_id,supplied)
    finally:
        temporary.unlink(missing_ok=True)
    return key

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    subs=parser.add_subparsers(dest='command',required=True)
    p=subs.add_parser('configure');p.add_argument('--url',required=True);p.add_argument('--token-file',required=True)
    subs.add_parser('doctor')
    p=subs.add_parser('upload');p.add_argument('file');p.add_argument('--name')
    p=subs.add_parser('generate');p.add_argument('card_id');p.add_argument('--max-image-calls',required=True,type=int,choices=[4]);p.add_argument('--request-key')
    p=subs.add_parser('status');p.add_argument('job_id')
    p=subs.add_parser('wait');p.add_argument('job_id');p.add_argument('--timeout',type=float,default=50);p.add_argument('--interval',type=float,default=5)
    p=subs.add_parser('card');p.add_argument('card_id')
    p=subs.add_parser('list');p.add_argument('--limit',type=int,default=50)
    p=subs.add_parser('preview');p.add_argument('card_id')
    p=subs.add_parser('download');p.add_argument('card_id');p.add_argument('--output',required=True);p.add_argument('--extract',action='store_true')
    p=subs.add_parser('openapi');p.add_argument('--output',required=True)
    args=parser.parse_args()
    if args.command=='configure':
        content=Path(args.token_file).expanduser().read_text().strip()
        try: secret=json.loads(content)['api_token']
        except (ValueError,TypeError,KeyError): secret=content
        private_json(config_path(),{'api_url':valid_url(args.url),'api_token':secret})
        emit({'configured':True,'api_url':valid_url(args.url),'config_file':str(config_path())});return
    client=Client()
    if args.command=='doctor': emit({'api_url':client.config['api_url'],**client.request('/v1/status')})
    elif args.command=='upload': emit(client.upload(args.file,args.name))
    elif args.command=='generate':
        key=request_key(args.card_id,args.request_key)
        emit(client.request('/v1/cards/'+segment(args.card_id)+'/generations','POST',{'max_image_calls':args.max_image_calls},{'Idempotency-Key':key}))
    elif args.command=='status': emit(client.request('/v1/jobs/'+segment(args.job_id)))
    elif args.command=='card': emit(client.request('/v1/cards/'+segment(args.card_id)))
    elif args.command=='list': emit(client.request('/v1/cards?limit='+str(max(1,min(100,args.limit)))))
    elif args.command=='preview': emit(client.request('/v1/cards/'+segment(args.card_id)+'/preview-links','POST'))
    elif args.command=='wait':
        deadline=time.monotonic()+max(0,min(55,args.timeout));previous=None
        while True:
            value=client.request('/v1/jobs/'+segment(args.job_id),timeout=min(10,max(1,deadline-time.monotonic())))
            fingerprint=json.dumps([value['status'],value['layers']],sort_keys=True)
            if previous!=fingerprint: emit(value);previous=fingerprint
            if value['status'] in ('completed','failed','uncertain'): break
            if time.monotonic()>=deadline: emit({'waiting':True,'job_id':args.job_id,'status':value['status']});break
            time.sleep(min(max(1,args.interval),max(0,deadline-time.monotonic())))
    elif args.command=='download':
        target=Path(args.output).expanduser().resolve()
        if target.exists(): raise ClientError('OUTPUT_EXISTS','Choose a new output path; existing results are not overwritten.')
        target.parent.mkdir(parents=True,exist_ok=True)
        data=client.request('/v1/cards/'+segment(args.card_id)+'/bundle',binary=True)
        fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as out: out.write(data)
        result={'archive':str(target),'sha256':hashlib.sha256(data).hexdigest()}
        if args.extract:
            destination=target.with_suffix('')
            if destination.exists(): raise ClientError('OUTPUT_EXISTS','Archive saved, but extraction directory already exists.')
            with zipfile.ZipFile(target) as archive:
                for entry in archive.infolist():
                    candidate=(destination/entry.filename).resolve()
                    if not candidate.is_relative_to(destination) or stat.S_ISLNK(entry.external_attr>>16):
                        raise ClientError('UNSAFE_ARCHIVE','Archive contains an unsafe path; it was not extracted.')
                destination.mkdir(mode=0o700)
                archive.extractall(destination)
            result['html']=str(destination/'index.html')
        emit(result)
    elif args.command=='openapi':
        output=Path(args.output).expanduser().resolve();private_json(output,client.request('/openapi.json'));emit({'openapi':str(output)})

if __name__=='__main__':
    try: main()
    except ClientError as error:
        emit({'error':{'code':error.code,'message':error.message}});sys.exit(1)
    except (OSError,ValueError,KeyError):
        emit({'error':{'code':'LOCAL_CONFIGURATION_ERROR','message':'Check the local configuration, input and output paths. No credentials are printed.'}});sys.exit(1)
