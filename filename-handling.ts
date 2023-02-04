export function determineOutputFilename(filename: string): string | null {
  if (filename.endsWith('.url') || filename.endsWith('.pdf')) {
    return null;
  }
  if (filename.startsWith('Mapmaking/')) {
    return null;
  }

  filename = filename.replace(/^FA_Tokens\//, 'Tokens/');
  filename = filename.replace(
    /Tokens\/Spirits\/Creature[ _]Spirits_Pack_\d+/,
    'Tokens/Spirits/Creatures'
  );
  filename = filename.replace(
    'Spirits/Creature_Spirits/',
    'Spirits/Creatures/'
  );
  filename = filename.replace(
    /Spirits\/Spirits_(Adversaries|Creatures|Heroes|NPCs)\//,
    (_, g) => `Spirits/${g}/`
  );
  filename = filename.replace(
    'Spirits/Commoner_Spirits/',
    'Spirits/Commoners/'
  );
  filename = filename.replace('Creature Tokens Pack 2/', 'Tokens/');

  filename = filename.replace(/1⁄8/g, '1∕8');
  filename = filename.replace(/1⁄4/g, '1∕4');
  filename = filename.replace(/1⁄2/g, '1∕2');
  filename = filename.replace(/CR (.)/, (_, g) => `CR_${g[0]}`);
  filename = filename.replace('_Catch-All_Heroes', 'Catch-All_Heroes');
  filename = filename.replace(
    'Tokens/Spirits/Catch-All_Heroes_Spirits',
    'Tokens/Spirits/Catch-All_Heroes'
  );

  // Tokens/NPCs/Townsfolk_02/Townsfolk_AA1_01.png
  filename = filename.replace(/Townsfolk_(\d+)/, 'Townsfolk');

  // Creatures/CR_1/Giant_Bearded_Vulture_Large_Beast_01.png
  if (filename.startsWith('Creatures')) {
    filename = 'Tokens/' + filename;
  }

  // Consistency? :(
  filename = filename.replace('Unknown_CR', 'CR_unknown');

  const goodKnownPrefixes = [
    'Tokens/Adversaries/',
    /^Tokens\/Creatures\/CR_\d∕?\d?\//,
    /^Tokens\/Base(less)?\/CR_\d?∕?\d?\//,
    'Tokens/Creatures/CR_unknown/',
    /^Tokens\/Creatures\/(Aberration|Beast|Celestial|Construct|Dragon|Elemental|Fey|Fiend|Giant|Guards_Desert|Humanoid|Monstrosity|Ooze|Plant|Undead)\//,
    /^Tokens\/Spirits\/(Adversaries|Catch-All_Heroes|Commoners|Creatures|Heroes|NPCs)\//,
    /^Tokens\/Heroes\/(Bearfolk|Catch-All_Heroes|Dragonborn|Dwarf|Elf|Firbolg|Gnome|Goliath|Halfling|Half_Elf|Half_Orc|Human|Gnoll|Kenku|Kitsune|Planetouched|Tabaxi|Tiefling|Tortle|Trollkin|Warforged)\//,
    /^Tokens\/NPCs\/(Commoners|Townsfolk)\//,
    'Tokens/Spirits/Catch-All_Heroes_Spirits/',
  ];

  if (
    goodKnownPrefixes.some((f) => {
      if (f instanceof RegExp) {
        return f.test(filename);
      } else {
        return filename.startsWith(f);
      }
    })
  ) {
    return filename;
  }

  throw new Error(`What do I do with ${filename}?`);
}
