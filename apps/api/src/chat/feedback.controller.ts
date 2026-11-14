import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { unwrap } from '../common/supabase-error';
import { SupabaseService } from '../supabase/supabase.service';

export class FeedbackDto {
  @IsInt()
  @IsIn([-1, 1])
  rating: -1 | 1;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

const PAGE_SIZE = 50;

function parseRating(value?: string): -1 | 1 | undefined {
  if (value === undefined || value === '' || value === 'all') return undefined;
  if (value === '1' || value === 'up') return 1;
  if (value === '-1' || value === 'down') return -1;
  throw new BadRequestException('rating debe ser up, down o all');
}

/**
 * Valoraciones 👍/👎 del chat de la app y revisión de lo que preguntan los
 * visitantes en el widget.
 */
@Controller()
export class FeedbackController {
  constructor(private readonly supabase: SupabaseService) {}

  @Put('messages/:messageId/feedback')
  async rate(
    @CurrentUser() user: AuthUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: FeedbackDto,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    // RLS: solo se ven los mensajes de las conversaciones propias.
    const message = unwrap(
      await db
        .from('messages')
        .select('id, role, conversations!inner(company_id, project_id)')
        .eq('id', messageId)
        .single(),
      'Mensaje no encontrado',
    );
    if (message.role !== 'assistant') throw new BadRequestException('Solo se valoran respuestas del asistente');
    const conv = message.conversations as unknown as { company_id: string; project_id: string };
    return unwrap(
      await db
        .from('message_feedback')
        .upsert(
          {
            message_id: messageId,
            company_id: conv.company_id,
            project_id: conv.project_id,
            user_id: user.id,
            rating: dto.rating,
            comment: dto.comment?.trim() || null,
          },
          { onConflict: 'message_id' },
        )
        .select('message_id, rating, comment, updated_at')
        .single(),
    );
  }

  @Delete('messages/:messageId/feedback')
  @HttpCode(204)
  async unrate(@CurrentUser() user: AuthUser, @Param('messageId', ParseUUIDPipe) messageId: string) {
    const db = this.supabase.forUser(user.accessToken);
    unwrap(await db.from('message_feedback').delete().eq('message_id', messageId));
  }

  /**
   * Valoraciones del chat interno. Owner/admin ven las de todo el equipo (RLS);
   * el resto, solo las suyas. Incluye la pregunta que originó cada respuesta.
   */
  @Get('projects/:projectId/feedback')
  async list(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('rating') rating?: string,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    let query = db
      .from('message_feedback')
      .select('message_id, rating, comment, created_at, updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(PAGE_SIZE);
    const r = parseRating(rating);
    if (r) query = query.eq('rating', r);
    const rows = unwrap(await query);
    if (!rows.length) return [];

    // Las filas ya están autorizadas por RLS; los textos se leen con service_role
    // porque los mensajes de otros miembros no son visibles para el usuario.
    const admin = this.supabase.admin;
    const ids = rows.map((f) => f.message_id as string);
    const { data: answers } = await admin
      .from('messages')
      .select('id, conversation_id, content, model_info, created_at')
      .in('id', ids);
    const byId = new Map((answers ?? []).map((m) => [m.id as string, m]));

    return Promise.all(
      rows.map(async (f) => {
        const answer = byId.get(f.message_id as string);
        let question: string | null = null;
        if (answer) {
          const { data: prev } = await admin
            .from('messages')
            .select('content')
            .eq('conversation_id', answer.conversation_id)
            .eq('role', 'user')
            .lte('created_at', answer.created_at)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          question = (prev?.content as string) ?? null;
        }
        return { ...f, question, answer: answer?.content ?? null, model_info: answer?.model_info ?? null };
      }),
    );
  }

  /** Lo que preguntan los visitantes del sitio web (owner/admin/editor, por RLS). */
  @Get('projects/:projectId/widget-messages')
  async widgetMessages(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('rating') rating?: string,
    @Query('before') before?: string,
  ) {
    const db = this.supabase.forUser(user.accessToken);
    let query = db
      .from('widget_messages')
      .select('id, session_id, question, answer, model_info, cached, rating, feedback_comment, feedback_at, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    const r = parseRating(rating);
    if (r) query = query.eq('rating', r);
    if (before) {
      if (Number.isNaN(Date.parse(before))) throw new BadRequestException('before debe ser una fecha');
      query = query.lt('created_at', before);
    }
    return unwrap(await query);
  }
}
