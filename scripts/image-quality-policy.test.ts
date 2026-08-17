import assert from 'node:assert/strict'
import {IMAGE_STORAGE_PROFILES,IMAGE_TRANSFORM_RECIPE,evaluateImageQuality} from '../src/utils/imageQualityPolicy.ts'

assert.deepEqual(IMAGE_STORAGE_PROFILES.accounting,{maxDimension:2500,quality:{min:92,max:95},defaultQuality:94})
assert.equal(IMAGE_STORAGE_PROFILES.handwriting.maxDimension,2800)
assert.deepEqual(IMAGE_STORAGE_PROFILES.system_error.quality,{min:88,max:90})
assert.deepEqual(IMAGE_STORAGE_PROFILES.general.quality,{min:78,max:82})
assert.equal(IMAGE_STORAGE_PROFILES.thumbnail.minDimension,480)
assert.equal(IMAGE_STORAGE_PROFILES.thumbnail.maxDimension,640)
assert.ok(IMAGE_TRANSFORM_RECIPE.operations.includes('strip_exif_gps'))
assert.deepEqual(IMAGE_TRANSFORM_RECIPE.operations,[
  'auto_orient','strip_exif_gps','deskew','white_balance','shadow_removal','denoise','text_sharpen',
])

const clean={blur:.1,glare:.05,crop:.01,finger:0,shadow:.1,missingPage:false}
const baseline={amount:.91,date:.88,tax_id:.94,document_number:.9}
assert.deepEqual(evaluateImageQuality(clean,baseline,{amount:.93,date:.9,tax_id:.95,document_number:.92}),{
  accepted:true,route:'continue',reasons:[],degradedCriticalFields:[],
})

const regression=evaluateImageQuality(clean,baseline,{amount:.89,date:.9,tax_id:.95,document_number:.92})
assert.equal(regression.route,'human_review')
assert.deepEqual(regression.degradedCriticalFields,['amount'])
assert.ok(regression.reasons.includes('critical_ocr_regression'))

const defects=evaluateImageQuality({...clean,blur:.8,glare:.3,finger:.1,missingPage:true},baseline,baseline)
assert.equal(defects.accepted,false)
assert.deepEqual(defects.reasons,['missing_page','blur_over_limit','glare_over_limit','finger_over_limit'])

console.log('DOC-INGEST-002 image quality policy checks passed')
