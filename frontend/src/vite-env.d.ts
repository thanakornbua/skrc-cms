/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EVENT_MODE: "registration" | "competition" | "concluded";
  readonly VITE_REGWEEK_API_URL: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_CONTROL_API_URL: string;
  readonly VITE_AMPLIFY_CONSOLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
