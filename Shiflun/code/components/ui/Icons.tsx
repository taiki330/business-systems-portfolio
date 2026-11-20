import { ReactNode } from "react";

type IconProps = { className?: string };

function Outline({ className = "size-5", children }: IconProps & { children: ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>;
}

export const CalendarIcon = (p: IconProps) => <Outline {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Outline>;
export const ClockIcon = (p: IconProps) => <Outline {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Outline>;
export const MapPinIcon = (p: IconProps) => <Outline {...p}><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.400 7 11 7 11Z" /><circle cx="12" cy="10" r="2.500" /></Outline>;
export const ChevronRightIcon = (p: IconProps) => <Outline {...p}><path d="m9 5 7 7-7 7" /></Outline>;
export const ChevronLeftIcon = (p: IconProps) => <Outline {...p}><path d="m15 5-7 7 7 7" /></Outline>;
export const ChevronDownIcon = (p: IconProps) => <Outline {...p}><path d="m5 9 7 7 7-7" /></Outline>;
export const CheckBadgeIcon = (p: IconProps) => <Outline {...p}><circle cx="12" cy="12" r="8.500" /><path d="m8.500 12.300 2.400 2.400 4.600-5" /></Outline>;
