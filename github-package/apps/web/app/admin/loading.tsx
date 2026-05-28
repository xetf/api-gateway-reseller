export default function AdminLoading() {
  return (
    <main className="admin-route-loading" aria-busy="true" aria-live="polite">
      <aside className="admin-route-loading-sidebar">
        <div className="admin-route-loading-mark" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="admin-route-loading-nav" key={index} />
        ))}
      </aside>
      <section className="admin-route-loading-main">
        <div className="admin-route-loading-bar" />
        <div className="admin-route-loading-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="admin-route-loading-card" key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
