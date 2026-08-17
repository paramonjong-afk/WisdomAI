import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

export function HealthMonitorRunner(){
  const {profile,currentCompany}=useAuth()
  useEffect(()=>{
    if(profile?.role!=='admin')return
    let stopped=false
    let timer=0
    const run=async()=>{
      const {data}=await supabase.from('health_monitor_settings').select('enabled,check_interval_minutes').eq('company_id',currentCompany?.company_id??'').eq('singleton',true).single()
      const minutes=Math.max(5,Number(data?.check_interval_minutes??5))
      if(!stopped&&data?.enabled&&document.visibilityState==='visible'){
        const {data:sessionData,error:sessionError}=await supabase.auth.refreshSession()
        const accessToken=sessionData.session?.access_token
        if(sessionError||!accessToken){
          window.dispatchEvent(new CustomEvent('wisdomai-health-run-result',{detail:{error:'Session Admin หมดอายุ กรุณาเข้าสู่ระบบใหม่'}}))
        }else{
          const {data:result,error}=await supabase.functions.invoke('health-monitor',{
            body:{source:'admin_session'},
            headers:{Authorization:`Bearer ${accessToken}`,'x-user-authorization':`Bearer ${accessToken}`},
          })
          window.dispatchEvent(new CustomEvent('wisdomai-health-run-result',{detail:{error:error?.message??'',status:result?.status??''}}))
        }
      }
      if(!stopped)timer=window.setTimeout(()=>void run(),minutes*60_000)
    }
    const applyNewSchedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>void run(),1_000)}
    timer=window.setTimeout(()=>void run(),15_000)
    window.addEventListener('wisdomai-health-config-changed',applyNewSchedule)
    return()=>{stopped=true;window.clearTimeout(timer);window.removeEventListener('wisdomai-health-config-changed',applyNewSchedule)}
  },[currentCompany?.company_id,profile?.role])
  return null
}
