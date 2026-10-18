<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Support tickets (spec 015): bug reports, feature requests and improvements filed by
 * members, worked by super administrators. The ticket id is its number (#42).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('support_tickets', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            // Null once the organization is deleted; the team keeps the ticket.
            $table->foreignId('organization_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('reporter_id')->constrained('users');
            $table->uuid('client_id');
            $table->string('type', 20);
            $table->string('title', 150);
            $table->string('status', 20)->default('new');
            $table->string('priority', 10)->default('normal');
            $table->foreignId('assignee_id')->nullable()->constrained('users')->nullOnDelete();
            $table->json('context')->nullable();
            $table->unsignedInteger('revision')->default(1);
            // The last reply nobody on the team has answered yet.
            $table->boolean('awaiting_team')->default(true);
            $table->timestampTz('last_activity_at');
            $table->timestampTz('last_public_activity_at');
            $table->foreignId('last_public_actor_id')->nullable()->constrained('users')->nullOnDelete();
            // Counts every action, and the public ones, for exact unread marks.
            $table->unsignedInteger('sequence')->default(0);
            $table->unsignedInteger('public_sequence')->default(0);
            $table->timestampTz('closed_at')->nullable();
            $table->timestampsTz();

            $table->unique(['reporter_id', 'client_id']);
            $table->index(['organization_id', 'last_activity_at']);
            $table->index(['status', 'awaiting_team', 'last_activity_at']);
            $table->index('assignee_id');
        });

        Schema::create('support_ticket_participants', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('added_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->unique(['ticket_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('support_ticket_messages', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->foreignId('author_id')->constrained('users');
            $table->text('body');
            // Internal notes are for the team only.
            $table->boolean('internal')->default(false);
            // Written from the admin app; stays marked Team if the author later loses the role.
            $table->boolean('from_team')->default(false);
            $table->uuid('client_id');
            $table->timestampTz('created_at');

            $table->unique(['author_id', 'client_id']);
            $table->index(['ticket_id', 'id']);
        });

        Schema::create('support_ticket_attachments', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->foreignId('message_id')->constrained('support_ticket_messages')->cascadeOnDelete();
            $table->string('name');
            $table->string('mime', 100);
            $table->unsignedInteger('size');
            $table->string('path');
            $table->timestampTz('created_at');

            $table->index('message_id');
            $table->index('ticket_id');
        });

        Schema::create('support_ticket_events', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('kind', 30);
            $table->json('from')->nullable();
            $table->json('to')->nullable();
            $table->boolean('internal')->default(false);
            // "reply" when a person's reply moved the status by itself.
            $table->string('cause', 20)->nullable();
            $table->foreignId('message_id')->nullable()->constrained('support_ticket_messages')->cascadeOnDelete();
            $table->timestampTz('created_at');

            $table->index(['ticket_id', 'id']);
        });

        Schema::create('support_ticket_reads', function (Blueprint $table): void {
            $table->foreignId('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // How far this person has read: all activity (team) and public activity.
            $table->unsignedInteger('sequence')->default(0);
            $table->unsignedInteger('public_sequence')->default(0);
            $table->timestampTz('read_at');

            $table->primary(['ticket_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('support_ticket_email_deliveries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // One email per action and recipient, however often the action is retried.
            $table->string('action_key', 64);
            $table->string('audience', 10);
            $table->string('kind', 30);
            $table->foreignId('message_id')->nullable()->constrained('support_ticket_messages')->cascadeOnDelete();
            $table->foreignId('event_id')->nullable()->constrained('support_ticket_events')->cascadeOnDelete();
            $table->string('status', 12)->default('pending');
            $table->timestampTz('sent_at')->nullable();
            $table->timestampsTz();

            $table->unique(['action_key', 'user_id']);
            $table->index('ticket_id');
        });

        Schema::table('notification_preferences', function (Blueprint $table): void {
            $table->boolean('ticket_email')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('notification_preferences', function (Blueprint $table): void {
            $table->dropColumn('ticket_email');
        });
        Schema::dropIfExists('support_ticket_email_deliveries');
        Schema::dropIfExists('support_ticket_reads');
        Schema::dropIfExists('support_ticket_events');
        Schema::dropIfExists('support_ticket_attachments');
        Schema::dropIfExists('support_ticket_messages');
        Schema::dropIfExists('support_ticket_participants');
        Schema::dropIfExists('support_tickets');
    }
};
