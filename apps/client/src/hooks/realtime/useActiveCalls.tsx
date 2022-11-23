import { useListener } from "@casper124578/use-socket.io";
import { SocketEvents } from "@snailycad/config";
import { Button } from "@snailycad/ui";
import { useAuth } from "context/AuthContext";
import { toastMessage } from "lib/toastMessage";
import toast from "react-hot-toast";
import { useAudio } from "react-use";
import { useCall911State } from "state/dispatch/call-911-state";
import type { Full911Call } from "state/dispatch/dispatch-state";
import type { ActiveDeputy } from "state/ems-fd-state";
import type { ActiveOfficer } from "state/leo-state";
import { useModal } from "state/modalState";
import { ModalIds } from "types/ModalIds";
import { useTranslations } from "use-intl";
import shallow from "zustand/shallow";

interface UseActiveCallsOptions {
  calls: Full911Call[];
  unit: ActiveDeputy | ActiveOfficer | null;
}

const ADDED_TO_CALL_SRC = "/sounds/added-to-call.mp3" as const;
const INCOMING_CALL_SRC = "/sounds/incoming-call.mp3" as const;

export function useActiveCalls({ unit, calls }: UseActiveCallsOptions) {
  const call911State = useCall911State(
    (state) => ({
      currentlySelectedCall: state.currentlySelectedCall,
      setCalls: state.setCalls,
      setCurrentlySelectedCall: state.setCurrentlySelectedCall,
    }),
    shallow,
  );
  const { user } = useAuth();
  const { openModal } = useModal();
  const t = useTranslations();

  const shouldPlayAddedToCallSound = user?.soundSettings?.addedToCall ?? false;
  const shouldPlayIncomingCallSound = user?.soundSettings?.incomingCall ?? false;
  const shouldSpeakIncomingCall = user?.soundSettings?.speech ?? true;
  const voiceURI = user?.soundSettings?.speechVoice;
  const availableVoices = typeof window !== "undefined" ? window.speechSynthesis.getVoices() : [];

  const [addedToCallAudio, , addedToCallControls] = useAudio({
    autoPlay: false,
    src: ADDED_TO_CALL_SRC,
  });

  const [incomingCallAudio, , incomingCallControls] = useAudio({
    autoPlay: false,
    src: INCOMING_CALL_SRC,
  });

  function handleSpeech(call: Full911Call) {
    try {
      const text = t(call.type?.value ? "Leo.assignedToCall#WithType" : "Leo.assignedToCall#", {
        callType: call.type?.value.value,
        caseNumber: call.caseNumber,
      });
      const utterThis = new SpeechSynthesisUtterance(text);

      const availableVoice = availableVoices.find((voice) => voice.voiceURI === voiceURI);
      if (voiceURI && availableVoice) {
        utterThis.voice = availableVoice;
      }

      utterThis.rate = 0.9;

      window.speechSynthesis.speak(utterThis);
    } catch (e) {
      console.error("Failed to speak.");
    }
  }

  function handleShowToast(call: Full911Call, previousCall: Partial<Full911Call> = {}) {
    if (shouldSpeakIncomingCall) {
      handleSpeech(call);
    }

    const messageId = toastMessage({
      duration: Infinity,
      title: "Assigned to call",
      icon: "success",
      message: (
        <div>
          <p>
            {t(call.type?.value ? "Leo.assignedToCall#WithType" : "Leo.assignedToCall#", {
              callType: call.type?.value.value,
              caseNumber: call.caseNumber,
            })}
          </p>

          <Button
            onPress={() => {
              openModal(ModalIds.Manage911Call);
              call911State.setCurrentlySelectedCall({
                ...previousCall,
                ...call,
              });

              toast.remove(messageId);
            }}
            className="mt-2 dark:border dark:border-quinary dark:bg-tertiary dark:hover:brightness-125"
          >
            View call
          </Button>
        </div>
      ),
    });
  }

  useListener(
    SocketEvents.Create911Call,
    (call: Full911Call | null) => {
      if (!call) return;
      if (calls.some((v) => v.id === call.id)) return;

      const wasAssignedToCall = call.assignedUnits.some((v) => v.unit?.id === unit?.id);

      if (shouldPlayIncomingCallSound) {
        incomingCallControls.seek(0);
        incomingCallControls.volume(0.3);
        incomingCallControls.play();
      }

      if (wasAssignedToCall) {
        handleShowToast(call);

        if (shouldPlayAddedToCallSound) {
          addedToCallControls.seek(0);
          addedToCallControls.volume(0.3);
          addedToCallControls.play();
        }
      }

      call911State.setCalls([call, ...calls]);
    },
    [
      calls,
      shouldPlayAddedToCallSound,
      shouldPlayIncomingCallSound,
      addedToCallControls,
      incomingCallControls,
      unit?.id,
    ],
  );

  useListener(
    SocketEvents.End911Call,
    (data: Full911Call | undefined) => {
      if (!data) return;
      call911State.setCalls(calls.filter((v) => v.id !== data.id));
    },
    [calls, call911State.setCalls],
  );

  useListener(
    SocketEvents.Update911Call,
    (call: Full911Call | undefined) => {
      if (!call) return;

      const prevCall = calls.find((v) => v.id === call.id);
      if (prevCall) {
        const wasAssignedToCall =
          !prevCall.assignedUnits.some((u) => u.unit?.id === unit?.id) &&
          call.assignedUnits.some((v) => v.unit?.id === unit?.id);

        if (wasAssignedToCall) {
          handleShowToast(call);

          if (shouldPlayAddedToCallSound) {
            addedToCallControls.seek(0);
            addedToCallControls.volume(0.3);
            addedToCallControls.play();
          } else {
            addedToCallControls.pause();
          }
        }
      }

      call911State.setCalls(
        calls.map((v) => {
          if (v.id === call.id) {
            if (call911State.currentlySelectedCall?.id === call.id) {
              call911State.setCurrentlySelectedCall({ ...v, ...call });
            }

            return { ...v, ...call };
          }

          return v;
        }),
      );
    },
    [calls, unit?.id, addedToCallControls, shouldPlayAddedToCallSound],
  );

  return {
    audio: {
      addedToCallAudio,
      incomingCallAudio,
    },
  };
}
