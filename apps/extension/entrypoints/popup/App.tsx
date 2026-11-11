import { citdCapabilities } from '@campuswatch/portal-core';

export function App() {
  const adapterStatus =
    citdCapabilities.implementationStatus === 'implemented' ? 'Ready' : 'Not implemented yet';

  return (
    <main className="popup">
      <h1>CampusWatch</h1>
      <p className="status" role="status">
        CampusWatch foundation ready
      </p>
      <dl>
        <dt>{citdCapabilities.displayName} adapter</dt>
        <dd>{adapterStatus}</dd>
        <dt>Monitoring</dt>
        <dd>Off. This build does not read the Portal.</dd>
      </dl>
    </main>
  );
}
