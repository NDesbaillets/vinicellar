"""Traitements photographiques locaux. Aucun modèle génératif, aucune API payante."""
from collections import deque
from io import BytesIO
import hashlib
import math
import warnings
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 24_000_000
MASTER = (1000, 1800)

class ProcessingError(ValueError):
    pass

def decode(data):
    if len(data) > 8 * 1024 * 1024:
        raise ProcessingError("Photo supérieure à 8 Mo.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(BytesIO(data))
            if image.format not in ("PNG", "JPEG", "WEBP"):
                raise ProcessingError("Format JPEG, PNG ou WebP requis.")
            image.load()
            image = ImageOps.exif_transpose(image).convert("RGBA")
            image.info.clear()  # Les dérivés ne recopient pas les métadonnées privées EXIF/GPS.
    except (UnidentifiedImageError, OSError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ProcessingError("Photo invalide ou trop grande.") from exc
    if min(image.size) < 100:
        raise ProcessingError("Photo trop petite : 100 pixels minimum par côté.")
    return image

def polygon(points, minimum=3):
    if not minimum <= len(points) <= 64 or any(len(p) != 2 or any(not isinstance(x, (int,float)) or not math.isfinite(x) or not 0 <= x <= 1 for x in p) for p in points):
        raise ProcessingError("Contour invalide.")
    area = abs(sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points)))) / 2
    if area < .01:
        raise ProcessingError("Contour trop petit ou points dans le mauvais ordre.")
    return points

def restore_label(image, settings):
    points = settings.get("corners", [])
    if points:
        polygon(points, 4)
        if len(points) != 4:
            raise ProcessingError("Indiquez les quatre coins de l'étiquette, dans l'ordre.")
        # Quadrilatère convexe TL, TR, BR, BL ; évite les transformations croisées.
        crosses = [(points[(i+1)%4][0]-points[i][0])*(points[(i+2)%4][1]-points[(i+1)%4][1])-(points[(i+1)%4][1]-points[i][1])*(points[(i+2)%4][0]-points[(i+1)%4][0]) for i in range(4)]
        if not (all(c > 0 for c in crosses) or all(c < 0 for c in crosses)):
            raise ProcessingError("Les coins de l'étiquette se croisent.")
        src = [(x*image.width,y*image.height) for x,y in points]
        width = int(max(math.dist(src[0],src[1]),math.dist(src[3],src[2])))
        height = int(max(math.dist(src[0],src[3]),math.dist(src[1],src[2])))
        if min(width,height) < 30 or not .2 <= width/height <= 5:
            raise ProcessingError("Recadrage d'étiquette trop petit ou disproportionné.")
        scale = min(1,1600/max(width,height)); width=max(100,int(width*scale)); height=max(100,int(height*scale))
        dst = [(0,0),(width,0),(width,height),(0,height)]
        matrix=[]; values=[]
        for (x,y),(u,v) in zip(dst,src):
            matrix.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]])
            values.extend([u,v])
        try:
            coeff=np.linalg.solve(np.asarray(matrix,float),np.asarray(values,float))
        except np.linalg.LinAlgError as exc:
            raise ProcessingError("Perspective impossible à corriger.") from exc
        image=image.transform((width,height),Image.Transform.PERSPECTIVE,coeff,Image.Resampling.BICUBIC)
    if not points and not settings.get("label_is_crop"):
        raise ProcessingError("Confirmez le recadrage ou indiquez quatre coins.")
    image=image.convert("RGB")
    image.thumbnail((1600,1600),Image.Resampling.LANCZOS)
    image=Image.blend(image,ImageOps.autocontrast(image,cutoff=.2,preserve_tone=True),.25)
    return image.filter(ImageFilter.UnsharpMask(radius=.6,percent=55,threshold=3))

def cutout(image, settings):
    outline=settings.get("outline", [])
    if outline:
        polygon(outline)
        mask=Image.new("L",(image.width*2,image.height*2))
        ImageDraw.Draw(mask).polygon([(int(x*image.width*2),int(y*image.height*2)) for x,y in outline],fill=255)
        mask=mask.resize(image.size,Image.Resampling.LANCZOS)
    elif image.getchannel("A").getextrema()[0] < 250:
        mask=image.getchannel("A")
    else:
        # Fond simple uniquement ; en cas d'ambiguïté, demander un contour plutôt qu'inventer.
        small=image.convert("RGB"); small.thumbnail((600,800))
        rgb=np.asarray(small).astype(float)
        corners=np.array([rgb[0,0],rgb[0,-1],rgb[-1,0],rgb[-1,-1]])
        background=np.median(corners,axis=0)
        if np.max(np.linalg.norm(corners-background,axis=1))>45:
            raise ProcessingError("Fond complexe : indiquez le contour de la bouteille ou utilisez un fond uni.")
        near=np.linalg.norm(rgb-background,axis=2)<45
        seen=np.zeros(near.shape,bool); h,w=near.shape
        todo=deque((x,y) for x in range(w) for y in (0,h-1))
        todo.extend((x,y) for y in range(h) for x in (0,w-1))
        while todo:
            x,y=todo.popleft()
            if not 0<=x<w or not 0<=y<h or seen[y,x] or not near[y,x]:
                continue
            seen[y,x]=True
            todo.extend(((x-1,y),(x+1,y),(x,y-1),(x,y+1)))
        ratio=float((~seen).mean())
        if not .025 < ratio < .75:
            raise ProcessingError("Détourage incertain : indiquez le contour de la bouteille.")
        mask=Image.fromarray(np.where(seen,0,255).astype("uint8")).resize(image.size,Image.Resampling.LANCZOS)
    box=mask.getbbox()
    if not box or box[0]<=1 or box[1]<=1 or box[2]>=image.width-1 or box[3]>=image.height-1:
        raise ProcessingError("La bouteille semble coupée par le bord de la photo. Fournissez une photo entière.")
    if (box[3]-box[1])/(box[2]-box[0])<1.2:
        raise ProcessingError("Proportions inhabituelles : vérifiez le contour et la photo complète.")
    image=image.copy(); image.putalpha(mask)
    return center(image.crop(box))

def center(image):
    scale=min((MASTER[0]-180)/image.width,(MASTER[1]-180)/image.height)
    image=image.resize((max(1,round(image.width*scale)),max(1,round(image.height*scale))),Image.Resampling.LANCZOS)
    result=Image.new("RGBA",MASTER)
    result.alpha_composite(image,((MASTER[0]-image.width)//2,(MASTER[1]-image.height)//2))
    return result

def reconstruct(label, settings):
    if not settings.get("confirmed_shape"):
        raise ProcessingError("Confirmez la forme indicative.")
    shape=settings.get("template"); color=settings.get("glass")
    if shape not in ("bordeaux","burgundy","champagne") or color not in ("green","brown","clear"):
        raise ProcessingError("Forme et verre requis.")
    w,h=MASTER; mask=Image.new("L",MASTER); draw=ImageDraw.Draw(mask)
    shoulder={"bordeaux":430,"burgundy":560,"champagne":610}[shape]
    draw.rounded_rectangle((280,shoulder,720,1700),radius=48,fill=255)
    draw.polygon([(435,110),(565,110),(565,300),(720,shoulder+55),(720,1620),(280,1620),(280,shoulder+55),(435,300)],fill=255)
    base={"green":(36,61,36),"brown":(75,48,27),"clear":(146,157,139)}[color]
    xs=np.arange(w); shading=.65+.5*np.exp(-((xs-380)/100)**2)+.2*np.exp(-((xs-660)/24)**2)
    pixels=np.zeros((h,w,4),dtype=np.uint8)
    for i,v in enumerate(base): pixels[:,:,i]=np.clip(v*shading,0,255).astype(np.uint8)
    pixels[:,:,3]=np.asarray(mask)
    bottle=Image.fromarray(pixels)
    # Capsule neutre ; aucun blason, logo ou texte généré.
    ImageDraw.Draw(bottle).rounded_rectangle((434,105,566,270),radius=10,fill=(112,112,102,255))
    label=label.copy().convert("RGBA"); label.thumbnail((410,560),Image.Resampling.LANCZOS)
    bottle.alpha_composite(label,((w-label.width)//2,1070-label.height//2))
    return bottle

def process(kind, source_bytes, settings):
    if kind == "label":
        image=restore_label(decode(source_bytes["label"]),settings); provenance="label_restored"
        notes=["Correction photographique ; aucun texte ni logo réécrit."]
    elif kind == "bottle" and settings["mode"] == "reconstructed":
        image=reconstruct(restore_label(decode(source_bytes["label"]),settings),settings); provenance="bottle_reconstructed"
        notes=["Reconstitution indicative : forme et couleur confirmées, capsule neutre ; seule l'étiquette provient de la photographie."]
    elif kind == "bottle":
        if not settings.get("full_bottle"):
            raise ProcessingError("La photo complète doit être confirmée.")
        image=cutout(decode(source_bytes["bottle"]),settings); provenance="bottle_cutout"
        notes=["Détourage photographique ; vérifier les contours, reflets et la transparence du verre."]
    else:
        raise ProcessingError("Type de visuel invalide.")
    stream=BytesIO(); image.save(stream,format="PNG",optimize=True); data=stream.getvalue()
    if len(data)>8*1024*1024:
        raise ProcessingError("Visuel trop volumineux : utilisez une photo moins bruitée.")
    if min(image.size)<100:
        raise ProcessingError("Étiquette trop étroite après correction.")
    alpha=image.mode=="RGBA" and image.getchannel("A").getextrema()[0]==0
    if kind=="bottle" and not alpha:
        raise ProcessingError("Transparence réelle absente.")
    return data,dict(width=image.width,height=image.height,has_alpha=alpha,sha256=hashlib.sha256(data).hexdigest(),provenance=provenance,warnings=notes)
