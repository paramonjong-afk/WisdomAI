-- Trigger functions do not need direct client execution. Keep the trigger active
-- while closing the callable surface for PUBLIC and API roles.
revoke all on function public.enforce_transfer_slip_vendor_match() from public, anon, authenticated;

notify pgrst, 'reload schema';
