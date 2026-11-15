import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, scopeOf, type AuthUser } from '../auth/auth-user';
import {
  FEEDBACK_REPOSITORY,
  WIDGET_MESSAGE_REPOSITORY,
  type FeedbackRepository,
  type Rating,
  type WidgetMessageRepository,
} from '../../../application/ports';

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

function parseRating(value?: string): Rating | undefined {
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
  constructor(
    @Inject(FEEDBACK_REPOSITORY) private readonly feedback: FeedbackRepository,
    @Inject(WIDGET_MESSAGE_REPOSITORY) private readonly visitorMessages: WidgetMessageRepository,
  ) {}

  @Put('messages/:messageId/feedback')
  async rate(
    @CurrentUser() user: AuthUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: FeedbackDto,
  ) {
    const scope = scopeOf(user);
    const message = await this.feedback.findMessage(scope, messageId);
    if (message.role !== 'assistant') throw new BadRequestException('Solo se valoran respuestas del asistente');
    return this.feedback.save(scope, {
      messageId,
      companyId: message.companyId,
      projectId: message.projectId,
      userId: user.id,
      rating: dto.rating,
      comment: dto.comment?.trim() || null,
    });
  }

  @Delete('messages/:messageId/feedback')
  @HttpCode(204)
  async unrate(@CurrentUser() user: AuthUser, @Param('messageId', ParseUUIDPipe) messageId: string) {
    await this.feedback.remove(scopeOf(user), messageId);
  }

  /**
   * Valoraciones del chat interno. Owner/admin ven las de todo el equipo;
   * el resto, solo las suyas. Incluye la pregunta que originó cada respuesta.
   */
  @Get('projects/:projectId/feedback')
  list(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('rating') rating?: string,
  ) {
    return this.feedback.list(scopeOf(user), projectId, parseRating(rating), PAGE_SIZE);
  }

  /** Lo que preguntan los visitantes del sitio web (owner/admin/editor, por permisos). */
  @Get('projects/:projectId/widget-messages')
  widgetMessages(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('rating') rating?: string,
    @Query('before') before?: string,
  ) {
    if (before && Number.isNaN(Date.parse(before))) throw new BadRequestException('before debe ser una fecha');
    return this.visitorMessages.list(scopeOf(user), projectId, { rating: parseRating(rating), before, limit: PAGE_SIZE });
  }
}
