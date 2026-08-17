import ReportLauncher from "./ReportLauncher";

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ReportLauncher />
    </>
  );
}
