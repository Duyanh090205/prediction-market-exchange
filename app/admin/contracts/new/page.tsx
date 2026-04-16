import Navbar from "@/app/components/Navbar";
import NewContractForm from "./NewContractForm";

export default function NewContractPage() {
  return (
    <>
      <Navbar />
      <main style={{ maxWidth: "600px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1.5rem", color: "#e4e4ed" }}>
          Create New Contract
        </h1>
        <NewContractForm />
      </main>
    </>
  );
}
