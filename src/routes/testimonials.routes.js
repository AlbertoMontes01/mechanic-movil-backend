import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { handleZodError } from '../lib/zodError.js';
import { prisma } from '../lib/prisma.js';
import { stripHtml } from '../lib/sanitize.js';

const router = Router();

const testimonialSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(1).max(1000),
  authorName: z.string().max(120).optional().nullable(),
});

function serializeTestimonial(t) {
  return {
    id: t.id,
    rating: t.rating,
    comment: t.comment,
    author_name: t.authorName || 'Verified PitStop user',
    created_date: t.createdAt,
  };
}

// Public -- the landing page carousel fetches this with no auth. Only ever
// returns the display-safe fields above, never mechanicId/email/name.
router.get('/public', async (req, res, next) => {
  try {
    const testimonials = await prisma.testimonial.findMany({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json(testimonials.map(serializeTestimonial));
  } catch (err) {
    next(err);
  }
});

// The mechanic's own testimonial, if they've left one -- powers the
// "edit your testimonial" state in Settings.
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const testimonial = await prisma.testimonial.findUnique({ where: { mechanicId: req.mechanicId } });
    res.json(testimonial ? serializeTestimonial(testimonial) : null);
  } catch (err) {
    next(err);
  }
});

// Upsert: one testimonial per mechanic, submitted/edited from Settings.
router.put('/me', requireAuth, async (req, res, next) => {
  try {
    const data = testimonialSchema.parse(req.body);
    const testimonial = await prisma.testimonial.upsert({
      where: { mechanicId: req.mechanicId },
      update: {
        rating: data.rating,
        comment: stripHtml(data.comment),
        authorName: stripHtml(data.authorName) || null,
      },
      create: {
        mechanicId: req.mechanicId,
        rating: data.rating,
        comment: stripHtml(data.comment),
        authorName: stripHtml(data.authorName) || null,
      },
    });
    res.json(serializeTestimonial(testimonial));
  } catch (err) {
    if (err.name === 'ZodError') return handleZodError(err, req, res);
    next(err);
  }
});

export default router;
