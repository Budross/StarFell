// Declarative service metadata, independent of contact and Dialogue execution.
export const communicationsEquipmentContracts = [
  { type: 'radioCommunication', label: 'Radio Communication', summary: 'Supports communication with reachable remote contacts.', owner: 'communications', consumers: ['communications', 'vessels'] },
  { type: 'signalScanning', label: 'Signal Scanning', summary: 'Supports compatible signal-scanning operations.', owner: 'communications', consumers: ['communications'] }
];
