-- Resolve a verified Neon Auth subject to the minimal MaliHub identity.
-- SECURITY DEFINER is intentional: the runtime role is not granted direct
-- access to users/profiles/sellers for identity resolution. Keep the result
-- narrow, the argument bound as TEXT, and EXECUTE unavailable to PUBLIC.

CREATE OR REPLACE FUNCTION public.resolve_malihub_identity(p_auth_user_id text)
RETURNS TABLE (
  user_id uuid,
  role text,
  email text,
  phone text,
  email_verified boolean,
  is_active boolean,
  is_banned boolean,
  onboarded boolean,
  seller_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    u.id,
    u.role::text,
    u.email,
    u.phone,
    u.email_verified,
    u.is_active,
    u.is_banned,
    COALESCE(p.onboarded, false),
    s.id
  FROM public.users AS u
  LEFT JOIN public.profiles AS p ON p.user_id = u.id
  LEFT JOIN public.sellers AS s ON s.user_id = u.id
  WHERE u.auth_user_id = p_auth_user_id
$function$;

REVOKE ALL ON FUNCTION public.resolve_malihub_identity(text) FROM PUBLIC;

-- The production runtime role is provisioned separately from schema
-- migrations. Grant only if it already exists; otherwise deployment must
-- grant EXECUTE explicitly after creating the restricted role.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'malihub_backend_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.resolve_malihub_identity(text) TO malihub_backend_runtime;
  END IF;
END
$grant$;
