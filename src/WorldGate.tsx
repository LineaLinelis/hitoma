import {
  IDKitSessionWidget,
  CredentialRequest,
  type IDKitResultSession,
  type RpContext,
} from "@worldcoin/idkit";
import { post } from "./api";

export interface GateContext {
  appId: `app_${string}`;
  rpContext: RpContext;
  signal: string;
  credentialExpiresMin: number;
  existingSessionId?: `session_${string}`;
}

export default function WorldGate({
  context,
  open,
  onOpenChange,
  onVerified,
  onError,
}: {
  context: GateContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void;
  onError: (message: string) => void;
}) {
  return (
    <IDKitSessionWidget
      open={open}
      onOpenChange={onOpenChange}
      app_id={context.appId}
      rp_context={context.rpContext}
      existing_session_id={context.existingSessionId}
      constraints={CredentialRequest("proof_of_human", {
        signal: context.signal,
        expires_at_min: context.credentialExpiresMin,
      })}
      environment="production"
      polling={{ timeout: 180000, interval: 2000 }}
      handleVerify={async (result: IDKitResultSession) => {
        try {
          await post("/api/auth/verify", result);
        } catch (error) {
          onError(
            error instanceof Error
              ? error.message
              : "認証を確認できませんでした。",
          );
          throw error;
        }
      }}
      onSuccess={() => onVerified()}
      onError={() =>
        onError(
          "World IDの認証を完了できませんでした。Proof of Humanが有効か確認して、もう一度お試しください。",
        )
      }
    />
  );
}
