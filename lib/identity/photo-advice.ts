export type PhotoAdvice='checking'|'ready'|'angle'|'tooSmall'|'noFace'|'multipleFaces'|'unavailable';
export type LightAdvice='ok'|'dark'|'bright'|'unavailable';

/** Minimum normalized face bounding-box geometric mean (sqrt(width * height)) for a shoulder-up selfie. */
export const MIN_FACE_SIZE=0.16;

/** Broad quality hints, never an identity verdict or a calibrated pose measurement. */
export function assessPhotoPose(faces:number,matrix?:readonly number[],faceSize?:number):Exclude<PhotoAdvice,'checking'> {
 if(faces===0)return 'noFace';
 if(faces>1)return 'multipleFaces';
 if(faces!==1||matrix?.length!==16||!matrix.every(Number.isFinite))return 'unavailable';
 if(faceSize!==undefined&&(!Number.isFinite(faceSize)||faceSize<=0))return 'unavailable';
 // MediaPipe's column-major canonical-face transform. Remove scale through ratios.
 const [x,y,z]=[matrix[8]!,matrix[9]!,matrix[10]!];
 if(Math.hypot(x,y,z)<0.1||Math.hypot(matrix[0]!,matrix[1]!)<0.1)return 'unavailable';
 if(faceSize!==undefined&&faceSize<MIN_FACE_SIZE)return 'tooSmall';
 const yaw=Math.atan2(x,z)*180/Math.PI;
 const pitch=Math.atan2(-y,Math.hypot(x,z))*180/Math.PI;
 const roll=Math.atan2(matrix[1]!,matrix[0]!)*180/Math.PI;
 return Math.abs(yaw)>20||Math.abs(pitch)>25||Math.abs(roll)>15?'angle':'ready';
}

/**
 * Exposure hint from a downscaled luma histogram (founder 2026-10-22: "각도/밝기 즉시 권고").
 * `mean` is the average luma 0–255; `clippedHigh`/`clippedLow` are the fractions of pixels at the
 * extremes. Thresholds are coarse by design: a hint about the light, never a gate.
 */
export function assessPhotoLight(input:{mean:number;clippedHigh:number;clippedLow:number}):LightAdvice {
 const {mean,clippedHigh,clippedLow}=input;
 if(![mean,clippedHigh,clippedLow].every(Number.isFinite))return 'unavailable';
 if(mean<60||clippedLow>0.45)return 'dark';
 if(mean>205||clippedHigh>0.35)return 'bright';
 return 'ok';
}

/** The advisory state deliberately never grants or denies permission. */
export function canSubmitSelfie(input:{hasFile:boolean;consent:boolean;busy:boolean;advice:PhotoAdvice;light?:LightAdvice}) {
 return input.hasFile&&input.consent&&!input.busy;
}
