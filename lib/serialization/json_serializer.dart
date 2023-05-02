// Copyright (c) 2023 Andrea Ballestrazzi

import 'dart:convert';
import 'dart:io';

///
/// Represents the basic interface used to serialize data to a json format.
abstract class JsonSerializer {
  Future<void> serialize(Map<String, dynamic> data);
}

class JsonFileSerializer implements JsonSerializer {
  const JsonFileSerializer({required this.projectFilePath});

  @override
  Future<void> serialize(Map<String, dynamic> data) async {
    final projectFile = await retrieveJsonFile();

    await projectFile.writeAsString(json.encode(data));
  }

  Future<File> retrieveJsonFile() async {
    assert(projectFilePath.isNotEmpty);

    return File(projectFilePath);
  }

  final String projectFilePath;
}
