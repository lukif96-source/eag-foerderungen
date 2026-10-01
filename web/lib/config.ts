// Öffentliche Verbindungsdaten – dieselben wie js/config.js der bestehenden App.
// Dürfen im Repo stehen: geschützt wird über Login + Row Level Security.
// Niemals hier das Datenbank-Passwort oder einen "secret"/"service_role"-Schlüssel eintragen.
export const CONFIG = {
  supabaseUrl: 'https://iuxklqcpexoziqxrohwa.supabase.co',
  supabaseKey: 'sb_publishable_VteOTQ6g28z9Dvo-QUG8jw_hehaZpWu',
  // Link zurück zur bestehenden App (Akte öffnen, Excel-Import …)
  appUrl: 'https://lukif96-source.github.io/eag-foerderungen/',
} as const;
