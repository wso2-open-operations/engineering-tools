// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { useIdleTimer } from "react-idle-timer";
import { useCallback, useState, type JSX, type ReactNode } from "react";
import { useAsgardeo } from "@asgardeo/react";
import SessionWarningDialog from "@components/session-warning/SessionWarningDialog";
import { IDLE_TIMEOUT_MS, IDLE_THROTTLE_MS } from "@constants/authConstants";
import { useLogger } from "@hooks/useLogger";

interface IdleTimeoutProviderProps {
  children: ReactNode;
}

/**
 * Shows "Are you still there?" after 15 minutes of inactivity.
 * Never auto-logs out — the session stays signed in indefinitely; it's purely
 * informational and waits for the user to choose Continue or Logout.
 */
export default function IdleTimeoutProvider({
  children,
}: IdleTimeoutProviderProps): JSX.Element {
  const [warningOpen, setWarningOpen] = useState(false);
  const { signOut, isSignedIn, isLoading } = useAsgardeo();
  const logger = useLogger();

  const handleLogout = useCallback(async () => {
    window.dispatchEvent(new CustomEvent("app:signing-out"));
    try {
      await signOut();
      setWarningOpen(false);
    } catch {
      logger.error("Error signing out after idle timeout");
      setWarningOpen(true);
    }
  }, [signOut, logger]);

  const { activate } = useIdleTimer({
    timeout: IDLE_TIMEOUT_MS,
    throttle: IDLE_THROTTLE_MS,
    onIdle: () => {
      if (isSignedIn && !isLoading) {
        setWarningOpen(true);
      }
    },
  });

  const handleContinue = () => {
    setWarningOpen(false);
    activate();
  };

  return (
    <>
      <SessionWarningDialog
        open={warningOpen}
        onContinue={handleContinue}
        onLogout={() => void handleLogout()}
      />
      {children}
    </>
  );
}
