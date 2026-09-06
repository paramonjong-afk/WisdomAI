-- Keep employee LINE identity administration callable only by signed-in users.
revoke all on function public.admin_link_employee_line_account(uuid,text,boolean,text) from anon;
revoke all on function public.admin_unlink_employee_line_account(uuid,text) from anon;
