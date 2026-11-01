"""Admin endpoints: kiosk remote commands, audio takes, ITC line transitions.

- ``governance.kiosk_commands``: signed remote commands per kiosk (KSK-10), idempotent per kiosk.
- ``governance.audio_takes``: uploaded recording takes per voice line and language (VOX-02), pending QC.
- ``governance.content_line_transitions``: append-only ITC sign-offs per line and language (VOX-07); the
  ``governance.forbid_mutation`` guard from 0002 rejects UPDATE and DELETE.

Additive only. The application role ``shriii_app`` gets read/write on the new tables.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "kiosk_commands",
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("kiosk_id", sa.String(length=64), nullable=False),
        sa.Column("command", sa.String(length=16), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("issued_by", sa.String(length=256), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("nonce", sa.String(length=32), nullable=False),
        sa.Column("signature", sa.Text(), nullable=False),
        sa.Column("key_id", sa.String(length=64), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "result", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["kiosk_id"], ["governance.kiosks.kiosk_id"], name=op.f("fk_kiosk_commands_kiosk_id_kiosks")
        ),
        sa.PrimaryKeyConstraint("command_id", name=op.f("pk_kiosk_commands")),
        sa.UniqueConstraint("kiosk_id", "idempotency_key", name=op.f("uq_kiosk_commands_kiosk_id_idempotency_key")),
        schema="governance",
    )
    op.create_index(
        op.f("ix_governance_kiosk_commands_kiosk_id"), "kiosk_commands", ["kiosk_id"], unique=False, schema="governance"
    )
    op.create_table(
        "audio_takes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("line_id", sa.String(length=128), nullable=False),
        sa.Column("language", sa.String(length=16), nullable=False),
        sa.Column("filename", sa.String(length=256), nullable=False),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("peak_dbfs", sa.Float(), nullable=True),
        sa.Column("rms_dbfs", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("uploaded_by", sa.String(length=256), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audio_takes")),
        schema="governance",
    )
    op.create_index(
        "ix_audio_takes_line_language", "audio_takes", ["line_id", "language"], unique=False, schema="governance"
    )
    op.create_table(
        "content_line_transitions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("line_id", sa.String(length=128), nullable=False),
        sa.Column("language", sa.String(length=16), nullable=False),
        sa.Column("from_status", sa.String(length=64), nullable=False),
        sa.Column("to_status", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False),
        sa.Column("signer", sa.String(length=256), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("recorded_by", sa.String(length=256), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_content_line_transitions")),
        schema="governance",
    )
    op.create_index(
        "ix_content_line_transitions_line_language",
        "content_line_transitions",
        ["line_id", "language"],
        unique=False,
        schema="governance",
    )
    op.execute(
        "CREATE TRIGGER trg_content_line_transitions_append_only BEFORE UPDATE OR DELETE "
        "ON governance.content_line_transitions FOR EACH ROW EXECUTE FUNCTION governance.forbid_mutation()"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shriii_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON governance.kiosk_commands TO shriii_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON governance.audio_takes TO shriii_app;
                GRANT SELECT, INSERT ON governance.content_line_transitions TO shriii_app;
                GRANT USAGE, SELECT ON SEQUENCE governance.content_line_transitions_id_seq TO shriii_app;
            END IF;
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_content_line_transitions_append_only ON governance.content_line_transitions")
    op.drop_index(
        "ix_content_line_transitions_line_language", table_name="content_line_transitions", schema="governance"
    )
    op.drop_table("content_line_transitions", schema="governance")
    op.drop_index("ix_audio_takes_line_language", table_name="audio_takes", schema="governance")
    op.drop_table("audio_takes", schema="governance")
    op.drop_index(op.f("ix_governance_kiosk_commands_kiosk_id"), table_name="kiosk_commands", schema="governance")
    op.drop_table("kiosk_commands", schema="governance")
