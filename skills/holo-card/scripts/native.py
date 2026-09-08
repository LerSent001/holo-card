#!/usr/bin/env python3
"""Local preparation and assembly for Codex built-in image generation. No API or network calls."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time
import zipfile
from PIL import Image, ImageOps, ImageChops

KINDS=('character','background','ui','structure')
ROOT=Path(__file__).resolve().parents[1]
TEMPLATES=ROOT/'assets/renderer'
TARGETS={
 'character':'The main illustrated character or main foreground subject. Select only its actually VISIBLE pixels, including its outline and internal colors. Exclude all printed text, icons, border, and scenery.',
 'background':'Only the VISIBLE background scenery inside the illustration. Exclude the main character, all printed text, symbols, UI, border and foreground subject. Occluded areas must remain black. Do not imagine hidden scenery.',
 'ui':'All VISIBLE printed text, letters, numerals, labels, symbols, badges, layout rules and card frame/border. Select the precise visible glyphs and graphic shapes, not large rectangular text boxes. Exclude character and scenery.',
 'structure':'Only the VISIBLE fine structural contour lines on the main illustrated character: outer contour and internal defining outlines of anatomy, armor, limbs, face and shape boundaries. Identify these by shape regardless of color. Draw thin white lines precisely on those existing contours. Do not select filled color regions, shading, text, UI, background lines, or the card frame. Do not invent or complete hidden contours.',
}

def prompt(kind):
    common=('Keep the entire original canvas, aspect ratio, exact positions and scale. Do not crop, recenter, redesign, '
            'change visible geometry. No checkerboard pixels, new text or added glow. ')
    if kind=='structure':
        return common+'Output a black background with thin white visible structural contour lines of the main illustrated subjects, including internal shape boundaries. No filled regions, text, UI or scenery lines. Use the final repaired subject layer as the reference so contours match its repaired anatomy exactly.'
    targets={
      'character':'Extract only the visible main illustrated subjects in their original COLORS onto genuine transparent alpha. Remove scenery, printed text, symbols, UI and frame. Where any typography, numerals, icons or UI overlap the subject, remove the entire overlay and inpaint the concealed subject with coherent neighboring colors, shading, texture and contours. These interior repaired areas must be opaque, never transparent holes. Preserve original anatomy, silhouette, scale and position. No residual glyphs or duplicated text. Transparency belongs only outside the subject silhouette. Keep eyes, mouth interiors, black ink, dark colors and shadows opaque; never classify dark subject pixels as background. The output must be a continuous independently usable colored subject, not disconnected pieces of the source card.',
      'background':'Automatically distinguish background scenery from foreground subjects and the combined typography/frame overlay. Produce a complete opaque COLOR background plate covering the entire canvas, including beneath the decorative border. Remove all subjects, printed text, UI and frame, and reconstruct ALL areas they concealed using the surrounding scenery, colors and directional strokes. No holes, transparent gaps, black voids or residual glyphs. Preserve visible scenery alignment.',
      'ui':'Extract the original colored typography, numerals, symbols, information bars AND the entire original decorative border/card frame together as ONE combined UI layer at the same depth, onto genuine transparent alpha. Keep frame and typography together, never as separate depth layers. Preserve glyphs and panel colors exactly at their original positions. Remove subjects and scenery. Do not redraw or rearrange text.'}
    return common+targets[kind]+' Output a colored RGBA layer, NOT a black-and-white mask or grayscale image.'

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,value):
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    temporary.replace(path)
def load(job):return json.loads((job/'task.json').read_text())
def summary(job,state):
    return {'job_directory':str(job),'execution':state['execution'],'status':state['status'],
            'completed_layers':sum(l['status']=='imported' for l in state['layers'].values()),'total_layers':4,
            'layers':{k:{'status':v['status'],'error':v.get('error')} for k,v in state['layers'].items()},
            'html':str(job/'index.html') if state['status']=='completed' else None,
            'archive':str(job/'card.zip') if state['status']=='completed' else None}

def prepare(source,job,name):
    if job.exists():raise ValueError('Output directory exists. Use status to resume it or choose a new directory.')
    with Image.open(source) as image:
        if image.format not in ('PNG','JPEG','WEBP') or getattr(image,'n_frames',1)!=1 or image.width*image.height>24_000_000:
            raise ValueError('Expected one PNG/JPEG/WebP frame up to 24 megapixels.')
        normalized=ImageOps.exif_transpose(image).convert('RGBA')
        normalized.thumbnail((1600,1600),Image.Resampling.LANCZOS)
    job.mkdir(parents=True,mode=0o700);(job/'masks').mkdir();(job/'raw').mkdir();(job/'assets').mkdir()
    original_name='original'+Path(source).suffix.lower();shutil.copyfile(source,job/original_name)
    normalized.save(job/'source.png')
    state={'version':2,'layer_mode':'direct_rgba','execution':'codex_builtin_image_gen','name':name or source.stem,'status':'awaiting_images','created_at':int(time.time()*1000),
           'source':{'original':original_name,'sha256':sha(source),'normalized_sha256':sha(job/'source.png'),'width':normalized.width,'height':normalized.height},
           'layers':{k:{'status':'pending','error':None} for k in KINDS},'repairs':{'background_inpainting':True,'subject_text_cleanup':True}}
    save(job/'task.json',state);save(job/'prompts.json',{k:prompt(k) for k in KINDS})
    return {**summary(job,state),'edit_target':str(job/'source.png'),'prompts':str(job/'prompts.json'),
            'next':'Use the Codex built-in image_gen tool once per layer, then import its actual returned image path with add. No API setup is needed.'}

def add(job,kind,path,tool_reference,replace=False):
    state=load(job)
    if state['layers'][kind]['status']=='imported' and not replace:raise ValueError('This layer is already imported. Use --replace only for an explicitly selected replacement image.')
    with Image.open(path) as image:
        if image.width*image.height>16_000_000 or getattr(image,'n_frames',1)!=1:raise ValueError('Mask image is too large or animated.')
        suffix={'JPEG':'.jpg','WEBP':'.webp'}.get(image.format,'.png');raw='raw/'+kind+suffix
        shutil.copyfile(path,job/raw)
        if abs((image.width/image.height)/(state['source']['width']/state['source']['height'])-1)>.025:
            state['layers'][kind]={'status':'needs_review','error':'MASK_ASPECT_MISMATCH','raw':raw,'sha256':sha(path)}
            state['status']='needs_review';save(job/'task.json',state)
            raise ValueError('Mask aspect ratio differs from the source. Its raw output is saved; no crop or regeneration was performed.')
        rgba=image.convert('RGBA')
        if state.get('layer_mode')=='direct_rgba' and kind!='structure':
            if kind != 'background' and rgba.getchannel('A').getextrema()[0]==255:
                state['layers'][kind]={'status':'needs_review','error':'MISSING_TRANSPARENCY','raw':raw,'sha256':sha(path)}
                state['status']='needs_review';save(job/'task.json',state)
                raise ValueError('Colored layer has no transparent pixels. Raw output saved; no automatic background removal performed.')
            if kind == 'background' and rgba.getchannel('A').getextrema()[0] < 255:
                state['layers'][kind]={'status':'needs_review','error':'BACKGROUND_HAS_HOLES','raw':raw,'sha256':sha(path)}
                state['status']='needs_review';save(job/'task.json',state)
                raise ValueError('Background must be fully opaque and inpainted. Raw output saved for review.')
        else:
            mask=ImageChops.multiply(rgba.convert('L'),rgba.getchannel('A'));mask.save(job/'masks'/f'{kind}.png')
    state['layers'][kind]={'status':'imported','error':None,'raw':raw,'sha256':sha(path),'format':('rgba' if state.get('layer_mode')=='direct_rgba' and kind!='structure' else 'mask'),'imported_at':int(time.time()*1000),'tool_reference':tool_reference}
    state['status']='ready_to_assemble' if all(v['status']=='imported' for v in state['layers'].values()) else 'awaiting_images'
    save(job/'task.json',state);return summary(job,state)

def html_document(job,state):
    data_url=lambda path:'data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode()
    manifest={'name':state['name'],'width':state['source']['width'],'height':state['source']['height'],
              'assets':{k:data_url(job/'assets'/f'{k}.png') for k in KINDS},'back':data_url(TEMPLATES/'back.png')}
    if state.get('preview_url'):
        manifest['previewUrl']=state['preview_url']
        manifest['previewQr']=data_url(job/'mobile-qr.png')
    data=json.dumps(manifest,ensure_ascii=True).replace('<','\\u003c')
    renderer=(TEMPLATES/'renderer.js').read_text().replace('export async function createCardRenderer','async function createCardRenderer')
    script='globalThis.HOLO_MANIFEST='+data+';\n'+renderer+'\nglobalThis.HOLO_CREATE_RENDERER=createCardRenderer;\n'+(TEMPLATES/'viewer.js').read_text()
    html=(TEMPLATES/'index.html').read_text()
    html=html.replace('<link rel="stylesheet" href="viewer.css?access=__ACCESS__">','<style>'+(TEMPLATES/'viewer.css').read_text()+'</style>')
    return html.replace('<script type="module" src="viewer.js?access=__ACCESS__"></script>','<script type="module">'+script+'</script>')

def assemble(job,preview_url=None):
    state=load(job)
    if preview_url is not None:
        from urllib.parse import urlsplit
        parsed=urlsplit(preview_url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Mobile preview URL must be an HTTPS address without embedded credentials.')
        try:
            import qrcode
        except ImportError:
            raise ValueError('Mobile QR generation requires the optional qrcode package: pip install qrcode')
        qrcode.make(preview_url).save(job/'mobile-qr.png')
        state['preview_url']=preview_url
    if any(layer['status']!='imported' for layer in state['layers'].values()):raise ValueError('All four actual image-tool outputs must be imported before assembly.')
    source=Image.open(job/'source.png').convert('RGBA');warnings=[]
    lut=[round(max(0,min(1,(v-24)/207))*255) for v in range(256)]
    for kind in KINDS:
        if state.get('layer_mode')=='direct_rgba' and kind!='structure':
            layer=Image.open(job/state['layers'][kind]['raw']).convert('RGBA').resize(source.size,Image.Resampling.LANCZOS)
            layer.save(job/'assets'/f'{kind}.png')
            if not layer.getchannel('A').getbbox():warnings.append(kind.upper()+'_EMPTY_LAYER')
            continue
        mask=Image.open(job/'masks'/f'{kind}.png').convert('L').resize(source.size,Image.Resampling.LANCZOS).point(lut)
        alpha=ImageChops.multiply(source.getchannel('A'),mask)
        layer=Image.new('RGBA',source.size,'white') if kind=='structure' else source.copy()
        layer.putalpha(alpha);layer.save(job/'assets'/f'{kind}.png')
        if not alpha.getbbox():warnings.append(kind.upper()+'_EMPTY_SELECTION')
    (job/'index.html').write_text(html_document(job,state))
    state['status']='completed';state['completed_at']=int(time.time()*1000);state['warnings']=warnings
    state['quality_review']='not_automatically_verified';save(job/'task.json',state)
    provenance={k:v for k,v in state.items() if k!='layers'}
    provenance['layers']={k:{key:value for key,value in layer.items() if key!='tool_reference'} for k,layer in state['layers'].items()}
    provenance['renderer']={'emission':40,'rgbm_range':64,'bloom_scales':[.5,.25]}
    save(job/'provenance.json',provenance)
    shutil.copyfile(TEMPLATES/'THIRD_PARTY_NOTICES.md',job/'THIRD_PARTY_NOTICES.md')
    names=['index.html','source.png',state['source']['original'],'provenance.json','prompts.json','THIRD_PARTY_NOTICES.md']
    if state.get('preview_url'):names.append('mobile-qr.png')
    names += [f'assets/{k}.png' for k in KINDS]+[f'masks/{k}.png' for k in KINDS if (job/'masks'/f'{k}.png').exists()]
    with zipfile.ZipFile(job/'card.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for name in names:archive.write(job/name,name)
    return summary(job,state)

def apply_alpha(job,kind,color_path,mask_path,reference,replace=False):
    """Apply an independently authored selection; never derive alpha from color."""
    state=load(job)
    if state.get('layer_mode')!='direct_rgba':raise ValueError('Requires a direct_rgba job.')
    if state['layers'][kind]['status']=='imported' and not replace:raise ValueError('Layer already imported; select --replace explicitly.')
    with Image.open(color_path) as color, Image.open(mask_path) as mask_image:
        if color.width*color.height>16_000_000:raise ValueError('Color image too large.')
        if color.size!=mask_image.size:raise ValueError('Color and mask must have identical dimensions; align explicitly first.')
        if abs((color.width/color.height)/(state['source']['width']/state['source']['height'])-1)>.025:raise ValueError('Color aspect ratio differs from card canvas.')
        if mask_image.mode not in ('1','L'):raise ValueError('Selection must be an explicit grayscale L or 1 mask, not a color image.')
        mask=mask_image.convert('L')
        low,high=mask.getextrema()
        if low!=0 or high!=255:raise ValueError('Selection must contain both fully transparent and fully opaque pixels.')
        rgba=color.convert('RGBA');rgba.putalpha(mask)
        folder=job/'alpha-inputs'/kind;folder.mkdir(parents=True,exist_ok=True)
        stamp=str(time.time_ns())
        color_copy=folder/(stamp+'-color.png');mask_copy=folder/(stamp+'-mask.png');out=folder/(stamp+'-rgba.png')
        color.convert('RGBA').save(color_copy);mask.save(mask_copy);rgba.save(out)
        for name,bg in [('black','black'),('white','white')]:
            plate=Image.new('RGBA',rgba.size,bg);plate.alpha_composite(rgba);plate.convert('RGB').save(folder/(stamp+'-review-'+name+'.png'))
    result=add(job,kind,out,reference,replace)
    state=load(job);state['layers'][kind]['alpha_method']='independent_selection'
    state['layers'][kind]['alpha_inputs']={'color':str(color_copy.relative_to(job)),'color_sha256':sha(color_copy),'mask':str(mask_copy.relative_to(job)),'mask_sha256':sha(mask_copy)}
    state['layers'][kind]['visual_review']='required: alignment, edge contamination, interior holes, text residue'
    save(job/'task.json',state)
    return {**summary(job,state),'review_directory':str(folder),'visual_review':'required'}

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('prepare');p.add_argument('--source',required=True);p.add_argument('--output',required=True);p.add_argument('--name')
    p=sub.add_parser('add');p.add_argument('--job',required=True);p.add_argument('--kind',choices=KINDS,required=True);p.add_argument('--image',required=True);p.add_argument('--tool-reference');p.add_argument('--replace',action='store_true')
    p=sub.add_parser('apply-alpha');p.add_argument('--job',required=True);p.add_argument('--kind',choices=('character','ui'),required=True);p.add_argument('--color',required=True);p.add_argument('--mask',required=True);p.add_argument('--tool-reference',required=True);p.add_argument('--replace',action='store_true')
    for command in ('assemble','status'):
        p=sub.add_parser(command);p.add_argument('--job',required=True)
        if command=='assemble':p.add_argument('--preview-url')
    args=parser.parse_args()
    if args.command=='prepare':result=prepare(Path(args.source).expanduser().resolve(),Path(args.output).expanduser().resolve(),args.name)
    else:
        job=Path(args.job).expanduser().resolve()
        if args.command=='add':result=add(job,args.kind,Path(args.image).expanduser().resolve(),args.tool_reference,args.replace)
        elif args.command=='apply-alpha':result=apply_alpha(job,args.kind,Path(args.color),Path(args.mask),args.tool_reference,args.replace)
        elif args.command=='assemble':result=assemble(job,args.preview_url)
        else:result=summary(job,load(job))
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':
    try:main()
    except (ValueError,OSError,KeyError) as error:
        print(json.dumps({'error':str(error),'api_called':False,'generation_started_by_script':False},ensure_ascii=False));sys.exit(1)
