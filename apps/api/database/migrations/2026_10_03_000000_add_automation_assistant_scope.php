<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assistant_conversations', function (Blueprint $table): void {
            $table->string('scope')->default('profile')->index();
            $table->foreignId('automation_workflow_id')->nullable()->constrained('automation_workflows')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('assistant_conversations', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('automation_workflow_id');
            $table->dropIndex(['scope']);
            $table->dropColumn('scope');
        });
    }
};
