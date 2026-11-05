"""Photos synthétiques de test, jamais présentées comme des photos de vrais vins."""
import unittest
import hashlib
from io import BytesIO
from PIL import Image,ImageDraw
from processor import process,ProcessingError
from worker import Worker

def png(image):
    stream=BytesIO();image.save(stream,format='PNG');return stream.getvalue()
def label():
    image=Image.new('RGB',(400,300),(236,228,203));d=ImageDraw.Draw(image)
    d.text((65,80),'ORIGINAL 2020 - TEST',fill='black');d.rectangle((20,20,380,280),outline='black',width=3)
    return png(image)
def bottle(touch=False):
    image=Image.new('RGB',(400,800),'white');d=ImageDraw.Draw(image)
    d.polygon([(175,40),(225,40),(225,180),(290,270),(290,799 if touch else 750),(110,799 if touch else 750),(110,270),(175,180)],fill=(30,60,35))
    d.rectangle((125,400,275,580),fill=(236,228,203));d.text((135,440),'TEST 2020',fill='black');return png(image)

class PhotographicTests(unittest.TestCase):
    def test_cutout_transparency_center_and_original_preserved(self):
        data=bottle();before=hashlib.sha256(data).hexdigest()
        result,meta=process('bottle',{'bottle':data},{'mode':'cutout','full_bottle':True})
        out=Image.open(BytesIO(result));self.assertEqual(out.size,(1000,1800));self.assertEqual(out.mode,'RGBA');self.assertTrue(meta['has_alpha'])
        self.assertEqual(out.getpixel((0,0))[3],0);box=out.getbbox();self.assertGreaterEqual(box[0],89);self.assertGreaterEqual(box[1],89)
        self.assertLessEqual(abs((box[0]+box[2])/2-500),1);self.assertLessEqual(abs((box[1]+box[3])/2-900),1)
        self.assertEqual(before,hashlib.sha256(data).hexdigest());self.assertEqual(meta['provenance'],'bottle_cutout');self.assertGreaterEqual(box[3]-box[1],1618)
    def test_manual_outline_on_complex_background(self):
        image=Image.open(BytesIO(bottle()));d=ImageDraw.Draw(image);d.rectangle((0,0,80,200),fill='red')
        with self.assertRaises(ProcessingError):process('bottle',{'bottle':png(image)},{'mode':'cutout','full_bottle':True})
        _,m=process('bottle',{'bottle':png(image)},{'mode':'cutout','full_bottle':True,'outline':[[.4375,.05],[.5625,.05],[.5625,.225],[.725,.3375],[.725,.9375],[.275,.9375],[.275,.3375],[.4375,.225]]})
        self.assertTrue(m['has_alpha'])
    def test_cropped_bottle_and_missing_confirmation_refused(self):
        for settings,source in [({'mode':'cutout','full_bottle':True},bottle(True)),({'mode':'cutout'},bottle())]:
            with self.assertRaises(ProcessingError):process('bottle',{'bottle':source},settings)
    def test_label_preserves_source_and_identity_transform(self):
        data=label();raw=Image.open(BytesIO(data));before=hashlib.sha256(data).hexdigest()
        a,meta=process('label',{'label':data},{'label_is_crop':True})
        b,_=process('label',{'label':data},{'corners':[[0,0],[1,0],[1,1],[0,1]]})
        self.assertEqual(a,b);self.assertEqual(Image.open(BytesIO(a)).size,raw.size)
        self.assertEqual(meta['provenance'],'label_restored');self.assertFalse(meta['has_alpha']);self.assertEqual(before,hashlib.sha256(data).hexdigest())
    def test_perspective_crop_and_invalid_crossed_corners(self):
        a,_=process('label',{'label':label()},{'corners':[[.1,.1],[.9,.12],[.8,.9],[.2,.8]]})
        self.assertLess(Image.open(BytesIO(a)).width,400)
        for settings in [{},{'corners':[[0,0],[1,1],[1,0],[0,1]]}]:
            with self.assertRaises(ProcessingError):process('label',{'label':label()},settings)
    def test_reconstruction_disclosed_and_label_pixels_preserved(self):
        settings={'mode':'reconstructed','template':'bordeaux','glass':'green','confirmed_shape':True,'label_is_crop':True}
        a,m=process('bottle',{'label':label()},settings);image=Image.open(BytesIO(a));restored=Image.open(BytesIO(process('label',{'label':label()},settings)[0])).convert('RGBA')
        self.assertEqual(m['provenance'],'bottle_reconstructed');self.assertIn('Reconstitution',m['warnings'][0]);self.assertTrue(m['has_alpha'])
        self.assertEqual(image.crop((300,920,700,1220)).tobytes(),restored.tobytes())
        with self.assertRaises(ProcessingError):process('bottle',{'label':label()},{**settings,'confirmed_shape':False})
    def test_phone_orientation_and_private_metadata(self):
        photo=Image.open(BytesIO(bottle())).transpose(Image.Transpose.ROTATE_90)
        exif=Image.Exif();exif[274]=6;exif[315]='PRIVATE TEST METADATA'
        stream=BytesIO();photo.save(stream,format='PNG',exif=exif)
        data,m=process('bottle',{'bottle':stream.getvalue()},{'mode':'cutout','full_bottle':True})
        result=Image.open(BytesIO(data));self.assertEqual(result.size,(1000,1800));self.assertFalse(result.getexif());self.assertNotIn('exif',result.info)
        self.assertTrue(m['has_alpha'])
    def test_untrusted_bytes_refused(self):
        for raw in [b'not a photo',png(Image.new('RGB',(20,20))),b'X'*(8*1024*1024+1)]:
            with self.assertRaises(ProcessingError):process('label',{'label':raw},{'label_is_crop':True})

class FakeWorker(Worker):
    def __init__(self,fail=False,changed=False):
        self.calls=[];self.fail=fail;self.sources={'label':label(),'bottle':bottle(True)}
        self.job={'id':'job','lease_token':'lease','collection_id':'coll','item_id':'item','sources':{'label':'u/label.png','bottle':'u/bottle.png'},'source_hashes':{k:hashlib.sha256(v).hexdigest() for k,v in self.sources.items()},'outputs':['label','bottle'],'settings':{'mode':'cutout','full_bottle':True,'label_is_crop':True}}
        if changed:self.job['source_hashes']['label']='0'*64
    def rpc(self,name,args):
        self.calls.append((name,args))
        return [self.job] if name=='studio_claim_job' else None
    def request(self,path,body=None,content_type=None):
        if self.fail:raise ConnectionError('offline')
        self.calls.append((path,body))
        if body is None:return self.sources[path.split('/')[-1].split('.')[0]]

class WorkerTests(unittest.TestCase):
    def test_independent_outputs_and_lease_specific_private_candidate(self):
        w=FakeWorker();self.assertTrue(w.once());name,finished=w.calls[-1]
        self.assertEqual(name,'studio_finish_job');self.assertEqual(len(finished['p_assets']),1)
        self.assertEqual(finished['p_assets'][0]['kind'],'label');self.assertIn('bottle',finished['p_errors'])
        self.assertEqual(finished['p_assets'][0]['candidate_path'],'coll/item/job/lease/label.png')
        self.assertEqual(finished['p_lease'],'lease')
        self.assertFalse(any('studio-approved' in n for n,_ in w.calls))
    def test_network_failure_leaves_job_for_retry_and_changed_source_fails(self):
        w=FakeWorker(fail=True)
        with self.assertRaises(ConnectionError):w.once()
        self.assertFalse(any(n=='studio_finish_job' for n,_ in w.calls))
        w=FakeWorker(changed=True);w.once();self.assertEqual(w.calls[-1][1]['p_assets'],[]);self.assertIn('system',w.calls[-1][1]['p_errors'])
    def test_no_arbitrary_destination_or_missing_key(self):
        for url,key in [('http://example.supabase.co','x'),('https://attacker.test','x'),('https://example.supabase.co','')]:
            with self.assertRaises(ValueError):Worker(url,key)

if __name__=='__main__':unittest.main()
