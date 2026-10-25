const P: Record<string, React.ReactNode> = {
  solar: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
  fission: <path d="M12 3l3 5H9zM6 21h12M8 21v-6h8v6M10 11h4" />,
  wrs: <path d="M12 3c3.5 4.5 5.5 7.5 5.5 10.5a5.5 5.5 0 0 1-11 0C6.5 10.5 8.5 7.5 12 3z" />,
  ice: <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9M9 4l3 2 3-2M9 20l3-2 3 2" />,
  oga: <><circle cx="9" cy="12" r="4" /><circle cx="16" cy="9" r="3" /><circle cx="16" cy="16" r="2.5" /></>,
  comms: <path d="M4 18c3-6 13-6 16 0M8 14l-2-7M16 14l2-7M12 13V5" />,
};
export default function EquipmentIcon({ kind }: { kind: string }) {
  return <span className="ico"><svg viewBox="0 0 24 24">{P[kind] ?? <circle cx="12" cy="12" r="6" />}</svg></span>;
}
