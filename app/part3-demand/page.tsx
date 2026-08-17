import Part3DemandModule from "../components/Part3DemandModule";

export default function Part3DemandPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(86,169,255,0.12), transparent 22%), radial-gradient(circle at top right, rgba(212,175,55,0.10), transparent 18%), linear-gradient(180deg, #0d141c 0%, #101720 100%)",
        padding: 20,
      }}
    >
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
        <Part3DemandModule />
      </div>
    </main>
  );
}
