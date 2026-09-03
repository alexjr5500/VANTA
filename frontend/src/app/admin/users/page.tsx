export default function AdminUsersPage() {
  return (
    <div className="min-h-screen pb-24 ">
      <div className="space-y-6">
        <div className="glass rounded-[32px] p-6 shadow-card">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400">Admin</p>
            <h1 className="text-3xl  font-bold text-white">Users</h1>
            <p className="text-sm text-gray-400 mt-2">Manage platform users.</p>
          </div>
        </div>
        <div className="glass rounded-[32px] p-12 text-center text-gray-500">
          <p className="text-lg font-medium">User management coming soon</p>
        </div>
      </div>
    </div>
  );
}