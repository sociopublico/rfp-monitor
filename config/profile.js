/**
 * Configuración del perfil de análisis para detección de oportunidades RFP/Proposals
 * 
 * Este archivo centraliza todos los parámetros configurables del sistema.
 * Modifica estos valores según tus necesidades sin tocar la lógica del código.
 */

module.exports = {
  // Keywords relacionadas con intereses temáticos de sociopublico
  // Se buscan en el contenido para determinar relevancia temática
  interestKeywords: [
    'public policy',
  'policy analysis',
  'policy research',
  'governance',
  'public governance',
  'institutional strengthening',
  'public sector reform',
  'state capacity',
  'democratic governance',
  'accountability',
  'transparency',
  'public administration', 
  'urban policy',
  'cities',
  'municipal',
  'local government',
  'urban development',
  'urban planning',
  'metropolitan',
  'territorial development',
  'regional development',
  'housing',
  'mobility',
  'transport',
  'research',
  'study',
  'evaluation',
  'assessment',
  'diagnostic',
  'baseline',
  'impact evaluation',
  'monitoring and evaluation',
  'm&e',
  'technical assistance',
  'consulting services',
  'terms of reference',
  'tor',
  'sustainable development',
  'climate change',
  'climate adaptation',
  'climate mitigation',
  'environmental policy',
  'resilience',
  'social development',
  'equity',
  'inclusion',
  'gender',
  'inequality',
  'democracy',
  'civic engagement',
  'citizen participation',
  'participatory processes',
  'open government',
  'open data',
  'human rights',
  'rule of law'
  ],

  // Keywords específicas de RFPs y oportunidades
  // Indican presencia de convocatorias, deadlines, etc.
  rfpKeywords: [
    'rfp',
  'request for proposal',
  'request for proposals',
  'call for proposal',
  'call for proposals',
  'call for tenders',
  'tender',
  'open call',
  'expression of interest',
  'eoi',
  'procurement notice',
  'invitation to bid',
  'ifb',
  'deadline',
  'submission deadline',
  'closing date',
  'due date',
  'apply',
  'application',
  'submission',
  'opening',
  'award',
  'contract duration',
  'convocatoria',
  'llamado',
  'llamado a consultoría',
  'licitación',
  'pliego',
  'términos de referencia',
  'tdr',
  'fecha límite',
  'cierre',
  'apertura',
  'presentación de propuestas'
  ],

  // Umbrales numéricos para el análisis
  analysisThresholds: {
    // Ratio mínimo de cambio de texto para considerar que hubo cambio significativo
    // Valor entre 0 y 1 (ej: 0.05 = 5% de cambio)
    minTextChangeRatio: 0.03,

    // Número mínimo de hits de keywords RFP para considerar relevante
    minKeywordHits: 2,

    // Score final mínimo (0-100) para generar una alerta
    minFinalScore: 20
  },

  // Configuración adicional
  settings: {
    // Longitud máxima del snippet de texto a analizar (caracteres)
    maxSnippetLength: 10000,

    // Si true, incluye análisis de fechas futuras en el scoring
    detectFutureDates: true
  }
};
