import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { handleZodError } from '../lib/zodError.js';
import { prisma } from '../lib/prisma.js';
import { stripHtml } from '../lib/sanitize.js';

const router = Router();
router.use(requireAuth);

// Not behind requireActiveSubscription -- this is a mandatory onboarding
// step shown to every account regardless of billing state (and billing
// enforcement is dark-launched off for almost everyone right now anyway).
const optionalText = z.string().max(300).optional().nullable();

const surveySchema = z.object({
  location: z.string().min(1).max(200),
  roles: z.array(z.string().min(1)).min(1),
  roleOther: optionalText,
  worksOn: z.array(z.string().min(1)).min(1),
  worksOnOther: optionalText,
  howYouWork: z.array(z.string().min(1)).min(1),
  howYouWorkOther: optionalText,
  yearsExperience: z.string().min(1),
  ageRange: z.string().min(1),
  operationSize: z.string().min(1),
  whatKeepsRunning: z.array(z.string().min(1)).min(1),
  trackingMethods: z.array(z.string().min(1)).min(1),
  trackingMethodsOther: optionalText,
});

const cleanArray = (arr) => (arr || []).map((s) => stripHtml(s));

function serialize(s) {
  if (!s) return null;
  return {
    location: s.location,
    roles: s.roles,
    role_other: s.roleOther,
    works_on: s.worksOn,
    works_on_other: s.worksOnOther,
    how_you_work: s.howYouWork,
    how_you_work_other: s.howYouWorkOther,
    years_experience: s.yearsExperience,
    age_range: s.ageRange,
    operation_size: s.operationSize,
    what_keeps_running: s.whatKeepsRunning,
    tracking_methods: s.trackingMethods,
    tracking_methods_other: s.trackingMethodsOther,
  };
}

// The row's existence is the "already answered" flag the frontend checks
// on every authenticated page load to decide whether to show the modal.
router.get('/me', async (req, res, next) => {
  try {
    const survey = await prisma.surveyResponse.findUnique({ where: { mechanicId: req.mechanicId } });
    res.json(serialize(survey));
  } catch (err) {
    next(err);
  }
});

router.post('/me', async (req, res, next) => {
  try {
    const data = surveySchema.parse(req.body);
    const fields = {
      location: stripHtml(data.location),
      roles: cleanArray(data.roles),
      roleOther: stripHtml(data.roleOther) || null,
      worksOn: cleanArray(data.worksOn),
      worksOnOther: stripHtml(data.worksOnOther) || null,
      howYouWork: cleanArray(data.howYouWork),
      howYouWorkOther: stripHtml(data.howYouWorkOther) || null,
      yearsExperience: data.yearsExperience,
      ageRange: data.ageRange,
      operationSize: data.operationSize,
      whatKeepsRunning: cleanArray(data.whatKeepsRunning),
      trackingMethods: cleanArray(data.trackingMethods),
      trackingMethodsOther: stripHtml(data.trackingMethodsOther) || null,
    };
    const survey = await prisma.surveyResponse.upsert({
      where: { mechanicId: req.mechanicId },
      update: fields,
      create: { mechanicId: req.mechanicId, ...fields },
    });
    res.status(201).json(serialize(survey));
  } catch (err) {
    if (err.name === 'ZodError') return handleZodError(err, req, res);
    next(err);
  }
});

export default router;
