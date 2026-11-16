-- DANGER: deletes every Automata Lab table and all data in them.
-- Development only. Auth users are NOT removed (delete them in the Supabase dashboard).
drop view if exists public.questions_public;
drop table if exists public.practice_history, public.automata, public.grades, public.submissions,
  public.questions, public.assignments, public.enrollments, public.courses, public.profiles cascade;
drop function if exists public.current_role_name, public.is_admin, public.teaches_course(uuid),
  public.enrolled_in(uuid), public.course_of_assignment(uuid);
