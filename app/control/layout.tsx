import ReportLauncher from "./ReportLauncher";
import CommercialAllocationTable from "./CommercialAllocationTable";
import RentBenchmarkPanel from "./RentBenchmarkPanel";

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CommercialAllocationTable />
      <RentBenchmarkPanel />
      <ReportLauncher />
    </>
  );
}
