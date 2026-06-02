import Navbar from "@/app/components/Navbar";

// Shared layout for every /admin route. Renders the global Navbar once so the
// admin sub-pages (Contracts / Users / Audit Log — which are Client Components
// and previously had no Navbar) keep the navigation, balance and Sign Out.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      {children}
    </>
  );
}
