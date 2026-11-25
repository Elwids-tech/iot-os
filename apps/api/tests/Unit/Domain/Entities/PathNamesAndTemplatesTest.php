<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Entities;

use App\Domain\Entities\Services\NamingTemplates;
use App\Domain\Entities\Services\PathNames;
use PHPUnit\Framework\TestCase;

final class PathNamesAndTemplatesTest extends TestCase
{
    public function test_path_names_are_suggested_from_display_names(): void
    {
        $this->assertSame('FillerPumpP201', PathNames::suggest('Filler pump P-201'));
        $this->assertSame('EastgateSS', PathNames::suggest('Eastgate SS'));
        $this->assertSame('CafeDeLaGare', PathNames::suggest('Café de la gare'));
        $this->assertSame('Mht', PathNames::suggest('محطة'), 'other scripts are transliterated where they can be');
        $this->assertSame('', PathNames::suggest('★ ☆'));
        $this->assertSame(64, strlen(PathNames::suggest(str_repeat('word ', 40))));
    }

    public function test_path_names_follow_the_character_rules(): void
    {
        $this->assertTrue(PathNames::valid('Feeder12'));
        $this->assertTrue(PathNames::valid('TX-05_b.2'));
        $this->assertFalse(PathNames::valid('Feeder 12'));
        $this->assertFalse(PathNames::valid('a/b'));
        $this->assertFalse(PathNames::valid(''));
        $this->assertFalse(PathNames::valid(str_repeat('a', 65)));
    }

    public function test_naming_templates_compile_to_anchored_patterns(): void
    {
        $this->assertTrue(NamingTemplates::matches('Feeder<number>', 'Feeder12'));
        $this->assertFalse(NamingTemplates::matches('Feeder<number>', 'feeder-12'));
        $this->assertFalse(NamingTemplates::matches('Feeder<number>', 'Feeder12b'));
        $this->assertFalse(NamingTemplates::matches('Feeder<number>', 'XFeeder12'));
        $this->assertTrue(NamingTemplates::matches('TX<number>-<letter>', 'TX05-b'));
        $this->assertTrue(NamingTemplates::matches('<letters>.<text>', 'Floor.B2-East'));
        $this->assertTrue(NamingTemplates::matches('A.B', 'A.B'));
        $this->assertFalse(NamingTemplates::matches('A.B', 'AxB'), 'a dot is literal');
    }

    public function test_only_known_placeholders_and_path_characters_are_templates(): void
    {
        $this->assertNull(NamingTemplates::compile('Feeder<digits>'));
        $this->assertNull(NamingTemplates::compile('Feeder (.*)'));
        $this->assertNull(NamingTemplates::compile('Feeder<number'));
        $this->assertNull(NamingTemplates::compile(''));
        $this->assertNotNull(NamingTemplates::compile('Feeder<number>'));
    }
}
