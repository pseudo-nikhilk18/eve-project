import {
  createCentreSchema,
  createDiagnosticTestSchema,
  setCentreTestParamsSchema,
  setCentreTestSchema,
} from './diagnostics.schema.js';
import {
  createDiagnosticCentre,
  createDiagnosticTest,
  listDiagnosticCentres,
  setCentreTestPrice,
} from './diagnostics.service.js';

export function createDiagnosticsController({ database }) {
  return {
    async listCentres(_request, response) {
      const centres = await listDiagnosticCentres({ database });

      response.json({ data: { centres } });
    },

    async createCentre(request, response) {
      const input = createCentreSchema.parse(request.body);
      const centre = await createDiagnosticCentre({ database, ...input });

      response.status(201).json({ data: { centre } });
    },

    async createTest(request, response) {
      const input = createDiagnosticTestSchema.parse(request.body);
      const diagnosticTest = await createDiagnosticTest({ database, ...input });

      response.status(201).json({ data: { test: diagnosticTest } });
    },

    async setCentreTest(request, response) {
      const params = setCentreTestParamsSchema.parse(request.params);
      const input = setCentreTestSchema.parse(request.body);
      const offering = await setCentreTestPrice({
        database,
        ...params,
        ...input,
      });

      response.json({ data: { offering } });
    },
  };
}
