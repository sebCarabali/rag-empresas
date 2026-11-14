-- eval_cases: una política por acción (evita dos políticas permisivas en SELECT)
-- e índice para el ON DELETE SET NULL de eval_results.case_id.
drop policy "eval_cases_write_editors" on public.eval_cases;

create policy "eval_cases_insert_editors" on public.eval_cases
  for insert to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[])
    and exists (select 1 from public.projects p where p.id = project_id and p.company_id = eval_cases.company_id)
  );

create policy "eval_cases_update_editors" on public.eval_cases
  for update to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[]))
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[])
    and exists (select 1 from public.projects p where p.id = project_id and p.company_id = eval_cases.company_id)
  );

create policy "eval_cases_delete_editors" on public.eval_cases
  for delete to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'editor']::public.member_role[]));

create index eval_results_case_idx on public.eval_results (case_id);
