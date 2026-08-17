export type ImageStorageProfile = 'accounting'|'handwriting'|'system_error'|'general'|'thumbnail'

export type ImageQualityMetrics = {
  blur: number
  glare: number
  crop: number
  finger: number
  shadow: number
  missingPage: boolean
}

export type CriticalOcrField = 'amount'|'date'|'tax_id'|'document_number'
export type CriticalOcrScores = Partial<Record<CriticalOcrField,number>>

export const IMAGE_STORAGE_PROFILES = {
  accounting:{maxDimension:2500,quality:{min:92,max:95},defaultQuality:94},
  handwriting:{maxDimension:2800,quality:{min:95,max:95},defaultQuality:95},
  system_error:{maxDimension:2000,quality:{min:88,max:90},defaultQuality:90},
  general:{maxDimension:1600,quality:{min:78,max:82},defaultQuality:80},
  thumbnail:{maxDimension:640,minDimension:480,quality:{min:70,max:80},defaultQuality:75},
} as const

export const IMAGE_TRANSFORM_RECIPE = {
  version:'doc-ingest-002-v1',
  operations:['auto_orient','strip_exif_gps','deskew','white_balance','shadow_removal','denoise','text_sharpen'] as const,
  outputFormat:'webp',
} as const

const LIMITS={blur:0.45,glare:0.18,crop:0.08,finger:0.03,shadow:0.35} as const
const CRITICAL_FIELDS:CriticalOcrField[]=['amount','date','tax_id','document_number']

export type ImageQualityDecision={
  accepted:boolean
  route:'continue'|'human_review'
  reasons:string[]
  degradedCriticalFields:CriticalOcrField[]
}

/** Scores and defect ratios are normalized to 0..1. Higher OCR is better; higher defect metrics are worse. */
export function evaluateImageQuality(metrics:ImageQualityMetrics,before:CriticalOcrScores,after:CriticalOcrScores):ImageQualityDecision{
  const reasons:string[]=[]
  if(metrics.missingPage)reasons.push('missing_page')
  for(const key of ['blur','glare','crop','finger','shadow'] as const){
    if(!Number.isFinite(metrics[key])||metrics[key]<0||metrics[key]>1)reasons.push(`invalid_${key}_score`)
    else if(metrics[key]>LIMITS[key])reasons.push(`${key}_over_limit`)
  }
  const degradedCriticalFields=CRITICAL_FIELDS.filter(field=>{
    const previous=before[field],current=after[field]
    return previous!==undefined&&(current===undefined||current+0.001<previous)
  })
  if(degradedCriticalFields.length)reasons.push('critical_ocr_regression')
  return {accepted:reasons.length===0,route:reasons.length?'human_review':'continue',reasons,degradedCriticalFields}
}

export function storageProfile(profile:ImageStorageProfile){return IMAGE_STORAGE_PROFILES[profile]}
