#!/usr/bin/env python3
"""Remove explicitly seeded candidate matte regions; never infer candidates from color."""
import argparse
from collections import deque
from pathlib import Path
from PIL import Image

def selection(candidate, seeds, existing_alpha=None, protect=None):
    if candidate.mode not in ('1','L'):raise ValueError('Candidate must be a grayscale mask.')
    size=candidate.size;w,h=size
    for image in (existing_alpha,protect):
        if image is not None and (image.size!=size or image.mode not in ('1','L')):
            raise ValueError('All masks must be aligned grayscale images of identical size.')
    values=bytearray(candidate.convert('L').tobytes())
    protected=protect.convert('L').tobytes() if protect else bytes(w*h)
    alpha=bytearray(existing_alpha.convert('L').tobytes()) if existing_alpha else bytearray([255])*(w*h)
    queue=deque();seen=bytearray(w*h)
    if not seeds:raise ValueError('At least one inspected matte seed is required.')
    for x,y in seeds:
        if not (0<=x<w and 0<=y<h):raise ValueError('Seed outside canvas.')
        i=y*w+x
        if values[i]!=255 or protected[i]:raise ValueError('Seed must be inside a confirmed unprotected matte candidate.')
        if not seen[i]:seen[i]=1;queue.append(i)
    while queue:
        i=queue.popleft();alpha[i]=0;x=i%w;y=i//w
        for j in ([i-1] if x else [])+([i+1] if x+1<w else [])+([i-w] if y else [])+([i+w] if y+1<h else []):
            if not seen[j] and values[j]==255 and not protected[j]:seen[j]=1;queue.append(j)
    return Image.frombytes('L',size,bytes(alpha))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate',required=True);p.add_argument('--seed',action='append',required=True,help='Inspected x,y matte point; repeat for separate gaps')
    p.add_argument('--existing-alpha');p.add_argument('--protect');p.add_argument('--output',required=True)
    a=p.parse_args()
    result=selection(Image.open(a.candidate),[tuple(map(int,s.split(','))) for s in a.seed],Image.open(a.existing_alpha) if a.existing_alpha else None,Image.open(a.protect) if a.protect else None)
    output=Path(a.output)
    if output.exists():raise ValueError('Output exists; choose a new correction mask.')
    result.save(output)
