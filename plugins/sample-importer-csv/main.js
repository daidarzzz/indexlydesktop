/**
 * @file plugins/sample-importer-csv/main.js
 * @description Plugin de referencia oficial demostrando la extensión del pipeline de importación (app.importer),
 * conforme a la especificación de CustomImporter.
 */

const { Plugin } = require('indexly');

module.exports = class CsvImporterPlugin extends Plugin {
  async onload() {
    console.log(`[CsvImporterPlugin] Registrando importador CSV universal`);

    // Registrar importador en el pipeline del host
    this.app.importer.registerImporter({
      id: 'csv-tabular-importer',
      name: 'Importador Tabular CSV / TSV',
      extensions: ['csv', 'tsv'],
      canHandle: (filename, contentPrefix) => {
        const ext = (filename || '').split('.').pop() || '';
        return ['csv', 'tsv'].includes(ext.toLowerCase()) || (contentPrefix && contentPrefix.includes(','));
      },
      parse: async (content, filename) => {
        if (!content || !content.trim()) {
          return [];
        }

        const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const rowsCount = Math.max(0, lines.length - 1);

        const source = {
          id: `src_${Date.now()}`,
          name: filename,
          active: true,
          count: rowsCount,
        };

        return [source];
      },
    });
  }

  async onunload() {
    console.log(`[CsvImporterPlugin] Desregistrando importador CSV`);
  }
};
