import ReportLauncher from "./ReportLauncher";
import CommercialAllocationTable from "./CommercialAllocationTable";

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CommercialAllocationTable />
      <ReportLauncher />
    </>
  );
}
