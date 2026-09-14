/*
 * AppTour - the global first-look tour overlay.
 *
 * Thin wrapper over the shared <GuidedTour> engine: it builds the translated
 * step list for the chosen `mode` (short | full | null=chooser) and forwards
 * the controlled state. The host (AppShell) owns isActive / currentStep / mode
 * and the seen-flag persistence, so the tour can be driven from the header "?"
 * button and auto-launched once for new visitors.
 *
 * Lazy-loaded by AppShell so the GuidedTour + its CSS never land on the boot
 * chunk (mirrors how x-dash / x-bubbles pull it in on demand).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import GuidedTour from '@/components/guided-tour'
import { buildAppTourSteps } from './app-tour-steps'

export default function AppTour({ isActive, currentStep, mode, onNext, onBack, onSkip, onChoose, dayMode = false }) {
  const { t } = useTranslation()
  const steps = useMemo(() => buildAppTourSteps(t, mode), [t, mode])

  return (
    <GuidedTour
      steps={steps}
      isActive={isActive}
      currentStep={currentStep}
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
      onChoose={onChoose}
      dayMode={dayMode}
      ariaLabel={t('appTour.aria', 'Spectre welcome tour')}
    />
  )
}
