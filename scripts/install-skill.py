#!/usr/bin/env python3
"""Install or update exactly one holo-card directory; remove obsolete packaged files."""
import argparse
import hashlib
from pathlib import Path
import shutil
import tempfile

SOURCE=Path(__file__).resolve().parents[1]/'skills/holo-card'

def files(root):
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc' and p.name!='.DS_Store'}

def install(source,destination):
    source=source.resolve();destination=destination.expanduser().absolute()
    if destination.name!='holo-card':raise ValueError('Destination must be named holo-card.')
    if source==destination.resolve():return {'path':str(destination),'files':len(files(source)),'current':True}
    if source in destination.resolve().parents or destination.resolve() in source.parents:
        raise ValueError('Source and destination must not contain one another.')
    if destination.is_symlink():raise ValueError('Destination is a symlink; update its source instead.')
    if destination.exists():
        entry=destination/'SKILL.md'
        if not entry.is_file() or 'name: holo-card' not in entry.read_text():
            raise ValueError('Destination is not an existing holo-card installation.')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.holo-install-',dir=destination.parent) as folder:
        staged=Path(folder)/'holo-card'
        shutil.copytree(source,staged,ignore=shutil.ignore_patterns('__pycache__','*.pyc','.DS_Store'))
        expected=files(source)
        if files(staged)!=expected:raise ValueError('Staged installation verification failed.')
        previous=Path(folder)/'previous'
        if destination.exists():destination.rename(previous)
        try:staged.rename(destination)
        except Exception:
            if previous.exists():previous.rename(destination)
            raise
        if files(destination)!=expected:raise ValueError('Installed files differ from source.')
    return {'path':str(destination),'files':len(expected),'current':True}

if __name__=='__main__':
    import json
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination',type=Path,default=Path.home()/'.codex/skills/holo-card')
    args=parser.parse_args()
    print(json.dumps(install(SOURCE,args.destination)))
